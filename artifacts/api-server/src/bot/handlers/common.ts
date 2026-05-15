import TelegramBot from "node-telegram-bot-api";
import { logger } from "../../lib/logger";
import * as store from "../utils/store";
import * as sheets from "../utils/sheets";
import * as kb from "../utils/keyboards";
import { DIVISIONS } from "../config";

const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID ?? "";

export function registerCommonHandlers(bot: TelegramBot): void {
  bot.onText(/\/start/, async (msg) => {
    if (!msg.from) return;
    const id = String(msg.from.id);
    const username = msg.from.username || "";
    const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");

    if (id === ADMIN_ID) {
      let adminUser = store.getUser(id);
      if (!adminUser) {
        adminUser = { telegramId: id, username, fullName, role: "admin", isAllowed: true };
        store.setUser(adminUser);
        await sheets.saveUser(adminUser);
      }
      await bot.sendMessage(
        msg.chat.id,
        `👋 Xush kelibsiz, Admin!\n\n🤖 Boshqaruv paneli:`,
        { reply_markup: kb.adminMainKeyboard() }
      );
      return;
    }

    const existingUser = store.getUser(id);

    if (existingUser && existingUser.isAllowed) {
      let replyMarkup: TelegramBot.ReplyKeyboardMarkup;
      let greeting = `👋 Xush kelibsiz, ${existingUser.fullName || existingUser.username}!`;

      if (existingUser.role === "division_head") {
        replyMarkup = kb.divisionHeadMainKeyboard();
        greeting += "\n\n🏢 Bo'lim rahbari paneli:";
      } else {
        replyMarkup = kb.employeeMainKeyboard();
        greeting += "\n\n👤 Xodim paneli:";
      }

      await bot.sendMessage(msg.chat.id, greeting, { reply_markup: replyMarkup });
      return;
    }

    if (existingUser && !existingUser.isAllowed) {
      await bot.sendMessage(msg.chat.id, "⏳ Sizning so'rovingiz admin tomonidan ko'rib chiqilmoqda. Iltimos, kuting.");
      return;
    }

    const newUser = { telegramId: id, username, fullName, role: "employee" as const, isAllowed: false };
    store.setUser(newUser);
    await sheets.saveUser(newUser).catch((err) => logger.error({ err }, "Yangi foydalanuvchini saqlashda xato"));

    await bot.sendMessage(
      msg.chat.id,
      `👋 Salom, ${fullName || username}!\n\nBotdan foydalanish uchun admin ruxsati talab qilinadi. So'rovingiz adminga yuborildi.`
    );

    await bot.sendMessage(
      Number(ADMIN_ID),
      `🔔 *Yangi foydalanuvchi so'rovi!*\n\n👤 Ismi: ${fullName || "-"}\n📱 Username: @${username || "-"}\n🆔 Telegram ID: \`${id}\``,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Ruxsat berish", callback_data: `allow_user_${id}` },
              { text: "❌ Rad etish", callback_data: `deny_user_${id}` },
            ],
            [{ text: "👔 Bo'lim rahbari", callback_data: `role_head_${id}` }],
          ],
        },
      }
    );
    logger.info({ telegramId: id, username }, "Yangi foydalanuvchi so'rovi");
  });

  // FIX: Removed duplicate callback_query handler from common.ts.
  // allow_user_, deny_user_, role_head_, assign_div_ callbacks are all handled
  // in admin.ts with proper session management and better UX. Handling them
  // here as well caused double execution — both handlers would fire for every
  // admin callback, running the same logic twice.
}
