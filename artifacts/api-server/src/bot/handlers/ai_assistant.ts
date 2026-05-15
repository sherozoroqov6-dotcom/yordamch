import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { logger } from "../../lib/logger";
import * as store from "../utils/store";
import * as kb from "../utils/keyboards";

const SYSTEM_PROMPT_NORMAL = `Siz "AI Yordamchi" bo'lib, tashkilot xodimlari uchun ishlaysiz.
Har qanday savolga aniq, foydali va to'liq javob bering.
O'zbek tilida javob bering. Hisob-kitob, tahlil, matn yozish, tarjima, maslahat — barchasini qila olasiz.
Javoblaringiz tushunarli, tuzilgan va amaliy bo'lsin.`;

const SYSTEM_PROMPT_DEEP = `Siz yuqori darajadagi "AI Yordamchi" ekspert tahlilchisiz.
Har qanday savolni chuqur va keng ko'lamda tahlil qiling:

1. Savolning mohiyatini to'liq tushuning
2. Barcha muhim jihatlarni va bog'liq sohalarni ko'rib chiqing
3. Bir nechta nuqtai nazardan baholang (ijobiy/salbiy, imkoniyat/xavf, sabab/oqibat va h.k.)
4. Amaliy misollar, faktlar va mantiqiy dalillar keltiring
5. Xulosani aniq va amaliy tavsiyalar bilan yakunlang

O'zbek tilida javob bering. Javobni tuzilgan va bo'limlar bo'yicha yozing.
Har bir savol uchun kamida 500 so'z hajmida keng qamrovli javob tayyorlang.`;

const ANALYSIS_PROMPT = `Quyidagi savolni ko'rib chiqing va qisqacha tahlil rejasi tuzing (JSON formatida):
{
  "mavzu": "savolning asosiy mavzusi",
  "jihatlar": ["ko'rib chiqiladigan jihat 1", "jihat 2", "jihat 3", ...],
  "soha": "soha nomi (texnologiya/iqtisodiyot/sog'liqni saqlash/ta'lim/va h.k.)"
}

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
type AIUserState = { history: AIChatMessage[]; deepMode: boolean };

const userStates = new Map<string, AIUserState>();

function getUserState(id: string): AIUserState {
  if (!userStates.has(id)) {
    userStates.set(id, { history: [], deepMode: false });
  }
  return userStates.get(id)!;
}

async function sendSafe(
  bot: TelegramBot,
  chatId: number,
  text: string,
  replyMarkup: TelegramBot.ReplyKeyboardMarkup
): Promise<void> {
  const MAX = 4000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX) {
    chunks.push(text.slice(i, i + MAX));
  }
  for (let i = 0; i < chunks.length; i++) {
    const markup = i === chunks.length - 1 ? replyMarkup : undefined;
    try {
      await bot.sendMessage(chatId, chunks[i], {
        parse_mode: "Markdown",
        reply_markup: markup,
      });
    } catch {
      await bot.sendMessage(chatId, chunks[i], { reply_markup: markup });
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

async function deepAnalysis(
  client: OpenAI,
  model: string,
  question: string,
  history: AIChatMessage[],
  bot: TelegramBot,
  chatId: number,
  statusMsgId: number
): Promise<string> {
  await bot.editMessageText("🔍 Savol tahlil qilinmoqda...", {
    chat_id: chatId,
    message_id: statusMsgId,
  });

  const plan = await analyzeQuestion(client, model, question);

  if (plan) {
    const planText = `📋 *Tahlil rejasi*\n\n*Mavzu:* ${plan.mavzu}\n*Soha:* ${plan.soha}\n\n*Ko'rib chiqiladigan jihatlar:*\n${plan.jihatlar.map((j, i) => `${i + 1}. ${j}`).join("\n")}\n\n⏳ Chuqur javob tayyorlanmoqda...`;
    try {
      await bot.editMessageText(planText, {
        chat_id: chatId,
        message_id: statusMsgId,
        parse_mode: "Markdown",
      });
    } catch {
      await bot.editMessageText(planText.replace(/\*/g, ""), {
        chat_id: chatId,
        message_id: statusMsgId,
      });
    }
  } else {
    await bot.editMessageText("🔎 Keng qamrovli javob tayyorlanmoqda...", {
      chat_id: chatId,
      message_id: statusMsgId,
    });
  }

  const deepQuestion = plan
    ? `${question}\n\n[Quyidagi jihatlarni albatta qamrab oling: ${plan.jihatlar.join(", ")}]`
    : question;

  const res = await client.chat.completions.create({
    model,
    max_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_DEEP },
      ...history.slice(-10),
      { role: "user", content: deepQuestion },
    ],
  });

  return res.choices[0]?.message?.content || "Javob olishda xatolik yuz berdi.";
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
      userStates.set(id, { history: [], deepMode: false });
      await bot.sendMessage(
        chatId,
        "🤖 *AI Yordamchi*\n\nSavol yuboring — har qanday mavzuda yordam beraman!\n\n💡 *Oddiy rejim:* Aniq va qisqacha javob\n🔍 *Chuqur tahlil rejimi:* Ko'p jihatdan keng qamrovli tahlil\n\n*Chuqur tahlil* tugmasi orqali rejimni o'zgartiring.\n\n❌ Chiqish uchun /stop yozing.",
        { parse_mode: "Markdown", reply_markup: kb.aiChatKeyboard(false) }
      );
      return;
    }

    if (session.state !== "ai_chat") return;

    const state = getUserState(id);

    if (msg.text === "🔍 Chuqur tahlil: OFF") {
      state.deepMode = true;
      await bot.sendMessage(
        chatId,
        "🔍 *Chuqur tahlil rejimi YOQILDI*\n\nEndi har bir savolingizni chuqur tahlil qilib, keng ko'lamda javob beraman.",
        { parse_mode: "Markdown", reply_markup: kb.aiChatKeyboard(true) }
      );
      return;
    }

    if (msg.text === "🔍 Chuqur tahlil: ON") {
      state.deepMode = false;
      await bot.sendMessage(
        chatId,
        "💬 *Oddiy rejimga o'tildi*\n\nQisqa va aniq javoblar beriladi.",
        { parse_mode: "Markdown", reply_markup: kb.aiChatKeyboard(false) }
      );
      return;
    }

    if (msg.text === "🔄 Yangi suhbat") {
      userStates.set(id, { history: [], deepMode: state.deepMode });
      await bot.sendMessage(
        chatId,
        "✅ Suhbat tozalandi. Yangi savol yuboring.",
        { reply_markup: kb.aiChatKeyboard(state.deepMode) }
      );
      return;
    }

    if (msg.text === "❌ Chiqish" || msg.text === "/stop") {
      store.clearSession(id);
      userStates.delete(id);
      const mainKb = getMainKeyboard(user.role);
      await bot.sendMessage(chatId, "↩️ Asosiy menyu", { reply_markup: mainKb });
      return;
    }

    const userText = msg.text || msg.caption || "";
    if (!userText.trim()) {
      await bot.sendMessage(chatId, "Iltimos, savol yoki so'rovingizni matn ko'rinishida yuboring.");
      return;
    }

    state.history.push({ role: "user", content: userText });
    if (state.history.length > 20) state.history.splice(0, state.history.length - 20);

    const statusText = state.deepMode
      ? "🔍 Tahlil boshlanmoqda..."
      : "⏳ Javob tayyorlanmoqda...";
    const statusMsg = await bot.sendMessage(chatId, statusText);

    try {
      const { client, model } = getAIClient();
      let reply: string;

      if (state.deepMode) {
        reply = await deepAnalysis(client, model, userText, state.history, bot, chatId, statusMsg.message_id);
      } else {
        const res = await client.chat.completions.create({
          model,
          max_tokens: 4096,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_NORMAL },
            ...state.history,
          ],
        });
        reply = res.choices[0]?.message?.content || "Javob olishda xatolik yuz berdi.";
      }

      state.history.push({ role: "assistant", content: reply });

      await bot.deleteMessage(chatId, statusMsg.message_id);
      await sendSafe(bot, chatId, reply, kb.aiChatKeyboard(state.deepMode));
    } catch (err) {
      logger.error({ err }, "AI javobida xato");
      const errMsg =
        err instanceof Error && err.message.includes("sozlanmagan")
          ? `❌ ${err.message}`
          : "❌ AI javob berishda xatolik yuz berdi. Qayta urinib ko'ring.";
      try {
        await bot.editMessageText(errMsg, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });
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
