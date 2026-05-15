import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { logger } from "../../lib/logger";
import * as store from "../utils/store";
import * as kb from "../utils/keyboards";
import { performWebSearch } from "../utils/websearch";

const SYSTEM_PROMPT = `Siz "AI Yordamchi" — tashkilot xodimlari uchun yuqori darajadagi ekspert yordamchisiz.
O'zbek tilida javob bering. Zarur bo'lsa rus va ingliz tillarida ham javob bera olasiz.
Hisob-kitob, tahlil, matn yozish, tarjima, huquqiy maslahat, qonunchilik — barchasini qila olasiz.

Har qanday savolni chuqur va keng ko'lamda tahlil qiling:
1. Savolning mohiyatini to'liq tushuning
2. Barcha muhim jihatlarni va bog'liq sohalarni ko'rib chiqing
3. Bir nechta nuqtai nazardan baholang (ijobiy/salbiy, imkoniyat/xavf, sabab/oqibat)
4. Amaliy misollar, faktlar va mantiqiy dalillar keltiring
5. Xulosani aniq va amaliy tavsiyalar bilan yakunlang
Javobni bo'limlar bo'yicha tuzilgan holda yozing.`;

const ANALYSIS_PROMPT = `Quyidagi savolni ko'rib chiqing va qisqacha tahlil rejasi tuzing (JSON formatida):
{"mavzu":"savolning asosiy mavzusi","jihatlar":["jihat 1","jihat 2","jihat 3"],"soha":"soha nomi"}
Faqat JSON qaytaring, boshqa matn yo'q.`;

function getAIClient(): { client: OpenAI; model: string } {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (baseURL && replitKey) {
    return { client: new OpenAI({ baseURL, apiKey: replitKey }), model: "gpt-4o-mini" };
  }
  if (groqKey) {
    return {
      client: new OpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: groqKey }),
      model: "llama-3.3-70b-versatile",
    };
  }
  if (openaiKey) {
    return { client: new OpenAI({ apiKey: openaiKey }), model: "gpt-4o-mini" };
  }
  throw new Error("AI integratsiyasi sozlanmagan. GROQ_API_KEY yoki OPENAI_API_KEY kerak.");
}

type AIChatMessage = { role: "user" | "assistant"; content: string };

const chatHistories = new Map<string, AIChatMessage[]>();

async function sendSafe(
  bot: TelegramBot,
  chatId: number,
  text: string,
  replyMarkup: TelegramBot.ReplyKeyboardMarkup
): Promise<void> {
  const MAX = 4000;
  for (let i = 0; i < text.length; i += MAX) {
    const chunk = text.slice(i, i + MAX);
    const isLast = i + MAX >= text.length;
    try {
      await bot.sendMessage(chatId, chunk, {
        parse_mode: "Markdown",
        reply_markup: isLast ? replyMarkup : undefined,
      });
    } catch {
      await bot.sendMessage(chatId, chunk, { reply_markup: isLast ? replyMarkup : undefined });
    }
  }
}

async function analyzeQuestion(
  client: OpenAI,
  model: string,
  question: string
): Promise<{ mavzu: string; jihatlar: string[]; soha: string } | null> {
  try {
    const res = await client.chat.completions.create({
      model,
      max_tokens: 512,
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        { role: "user", content: question },
      ],
    });
    const raw = res.choices[0]?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
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
        "🤖 *AI Yordamchi*\n\nSavol yuboring — har qanday mavzuda chuqur tahlil qilib, internetdan ma'lumot izlab javob beraman!\n\n❌ Chiqish uchun /stop yozing.",
        { parse_mode: "Markdown", reply_markup: kb.aiChatKeyboard() }
      );
      return;
    }

    if (session.state !== "ai_chat") return;

    if (msg.text === "🔄 Yangi suhbat") {
      chatHistories.set(id, []);
      await bot.sendMessage(chatId, "✅ Suhbat tozalandi. Yangi savol yuboring.", {
        reply_markup: kb.aiChatKeyboard(),
      });
      return;
    }

    if (msg.text === "❌ Chiqish" || msg.text === "/stop") {
      store.clearSession(id);
      chatHistories.delete(id);
      await bot.sendMessage(chatId, "↩️ Asosiy menyu", {
        reply_markup: getMainKeyboard(user.role),
      });
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

    const statusMsg = await bot.sendMessage(chatId, "🌐 Internetdan qidirilmoqda...");

    try {
      const { client, model } = getAIClient();

      // Web qidiruv (har doim yoqiq)
      let webContext = "";
      try {
        const searchResult = await performWebSearch(userText, true);
        if (searchResult) {
          webContext =
            `\n\n[Internetdan topilgan ma'lumotlar]:\n${searchResult}\n\n` +
            `[Yuqoridagi ma'lumotlarga asoslanib javob bering, manba URL larini ham ko'rsating]`;
        }
      } catch (err) {
        logger.warn({ err }, "Web qidiruv xato");
      }

      // Tahlil rejasi
      await bot.editMessageText("🔍 Savol tahlil qilinmoqda...", {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      }).catch(() => {});

      const plan = await analyzeQuestion(client, model, userText);

      if (plan) {
        const planText =
          `📋 *Tahlil rejasi*\n\n*Mavzu:* ${plan.mavzu}\n*Soha:* ${plan.soha}\n\n` +
          `*Ko'rib chiqiladigan jihatlar:*\n${plan.jihatlar.map((j, i) => `${i + 1}. ${j}`).join("\n")}\n\n⏳ Javob yozilmoqda...`;
        try {
          await bot.editMessageText(planText, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: "Markdown",
          });
        } catch {
          await bot.editMessageText(planText.replace(/\*/g, ""), {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          });
        }
      } else {
        await bot.editMessageText("⏳ Javob yozilmoqda...", {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        }).catch(() => {});
      }

      const deepQuestion = plan
        ? `${userText}\n\n[Albatta qamrab oling: ${plan.jihatlar.join(", ")}]`
        : userText;

      const res = await client.chat.completions.create({
        model,
        max_tokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + webContext },
          ...history.slice(-10),
          { role: "user", content: deepQuestion },
        ],
      });

      const reply = res.choices[0]?.message?.content || "Javob olishda xatolik yuz berdi.";
      history.push({ role: "assistant", content: reply });
      chatHistories.set(id, history);

      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      await sendSafe(bot, chatId, reply, kb.aiChatKeyboard());
    } catch (err) {
      logger.error({ err }, "AI javobida xato");
      const errMsg =
        err instanceof Error && err.message.includes("sozlanmagan")
          ? `❌ ${err.message}`
          : "❌ AI javob berishda xatolik yuz berdi. Qayta urinib ko'ring.";
      try {
        await bot.editMessageText(errMsg, { chat_id: chatId, message_id: statusMsg.message_id });
      } catch {
        await bot.sendMessage(chatId, errMsg);
      }
    }
  });
}

function getMainKeyboard(role: string): TelegramBot.ReplyKeyboardMarkup {
  if (role === "admin") return kb.adminMainKeyboard();
  if (role === "division_head") return kb.divisionHeadMainKeyboard();
  return kb.employeeMainKeyboard();
}
