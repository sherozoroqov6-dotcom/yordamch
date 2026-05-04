import TelegramBot from "node-telegram-bot-api";
import type { User } from "../types";

export function buildMultiSelectKeyboard(
  users: User[],
  selectedIds: string[],
  togglePrefix: string,
  confirmCallback: string
): TelegramBot.InlineKeyboardMarkup {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];

  for (let i = 0; i < users.length; i += 2) {
    const row = users.slice(i, i + 2).map((u) => {
      const isSelected = selectedIds.includes(u.telegramId);
      return {
        text: `${isSelected ? "✅" : "⬜"} ${u.fullName || u.username || u.telegramId}`,
        callback_data: `${togglePrefix}_${u.telegramId}`,
      };
    });
    rows.push(row);
  }

  const count = selectedIds.length;
  rows.push([
    {
      text: count > 0 ? `📤 Yuborish (${count} kishi tanlandi)` : "⚠️ Avval tanlang",
      callback_data: count > 0 ? confirmCallback : "noop",
    },
  ]);

  return { inline_keyboard: rows };
}
