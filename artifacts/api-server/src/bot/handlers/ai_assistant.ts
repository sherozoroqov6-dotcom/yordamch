import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { logger } from "../../lib/logger";
import * as store from "../utils/store";
import * as kb from "../utils/keyboards";

const AI_SYSTEM_PROMPT = `Siz "AI Yordamchi" bo'lib, tashkilot xodimlari uchun ishlaysiz. 
Har qanday savolga aniq, qisqa va foydali javob bering. 
Uzbek tilida javob bering. Hisob-kitob, tahlil, matn yozish, tarjima, maslahat — barchasini qila olasiz.
Javoblaringiz tushunarli va amaliy bo'lsin.`;

function getOpenAIClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (baseURL && replitKey) {
    return new OpenAI({ baseURL, apiKey: replitKey });
  }
  if (openaiKey) {
    return new OpenAI({ apiKey: openaiKey });
  }
  throw new Error("AI integratsiyasi sozlanmagan. OPENAI_API_KEY yoki AI Integrations kerak.");
}

type AIChatMessage = { role: "user" | "assistant"; content: string };

const chatHistories = new Map<string, AIChatMessage[]>();

// FIX: Send message with Markdown, fall back to plain text if Telegram rejects
// the formatting (e.g. AI response contains unescaped special characters).
async function sendSafe(
  bot: TelegramBot,
  chatId: number,
  text: string,
  replyMarkup: TelegramBot.ReplyKeyboardMarkup
): Promise<void> {
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: replyMarkup,
    });
  } catch {
    // Telegram rejected the Markdown — send as plain text
    await bot.sendMessage(chatId, text, { reply_markup: replyMarkup });
  }
}

export function registerAIAssistantHandlers(bot: TelegramBot): void {
  bot.on("message", async (msg) => {
    if (!msg.from) return;
    const id = String(msg.from.id);
    const user = store.getUser(id);
    if (!user || !user.isAllowed) return;
    const chatId = msg.chat.id;
    const session = store.getSession(id);

    if (msg.text === "🤖 AI Yordamchi") {
      store.setSession(id, { state: "ai_chat" });
      chatHistories.set(id, []);
      await bot.sendMessage(
        chatId,
        "🤖 *AI Yordamchi*\n\nSavol yuboring — har qanday mavzuda yordam beraman!\n\nMisol: hisob-kitob, matn yozish, tarjima, tahlil, maslahat...\n\n❌ Chiqish uchun /stop yozing.",
        { parse_mode: "Markdown", reply_markup: kb.aiChatKeyboard() }
      );
      return;
    }

    if (session.state !== "ai_chat") return;

    if (msg.text === "🔄 Yangi suhbat") {
      chatHistories.set(id, []);
      await bot.sendMessage(chatId, "✅ Suhbat tozalandi. Yangi savol yuboring.");
      return;
    }

    if (msg.text === "❌ Chiqish" || msg.text === "/stop") {
      store.clearSession(id);
      chatHistories.delete(id);
      const mainKb = getMainKeyboard(user.role);
      await bot.sendMessage(chatId, "↩️ Asosiy menyu", { reply_markup: mainKb });
      return;
    }

    const userText = msg.text || msg.caption || "";
    if (!userText.trim()) {
      await bot.sendMessage(chatId, "Iltimos, savol yoki so'rovingizni matn ko'rinishida yuboring.");
      return;
    }

    const history = chatHistories.get(id) || [];
    history.push({ role: "user", content: userText });
    if (history.length > 20) history.splice(0, history.length - 20);

    const typingMsg = await bot.sendMessage(chatId, "⏳ Javob tayyorlanmoqda...");

    try {
      const client = getOpenAIClient();
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          ...history,
        ],
      });

      const reply = response.choices[0]?.message?.content || "Javob olishda xatolik yuz berdi.";
      history.push({ role: "assistant", content: reply });
      chatHistories.set(id, history);

      await bot.deleteMessage(chatId, typingMsg.message_id);
      // FIX: Use sendSafe which falls back to plain text if Markdown fails.
      // AI responses often contain *, _, `, [ characters that break Telegram's
      // Markdown parser when they appear in unexpected positions.
      await sendSafe(bot, chatId, reply, kb.aiChatKeyboard());
    } catch (err) {
      logger.error({ err }, "AI javobida xato");
      try {
        await bot.editMessageText(
          "❌ AI javob berishda xatolik yuz berdi. Qayta urinib ko'ring.",
          { chat_id: chatId, message_id: typingMsg.message_id }
        );
      } catch {
        await bot.sendMessage(chatId, "❌ AI javob berishda xatolik yuz berdi. Qayta urinib ko'ring.");
      }
    }
  });
}

function getMainKeyboard(role: string): TelegramBot.ReplyKeyboardMarkup {
  if (role === "admin") return kb.adminMainKeyboard();
  if (role === "division_head") return kb.divisionHeadMainKeyboard();
  return kb.employeeMainKeyboard();
}
