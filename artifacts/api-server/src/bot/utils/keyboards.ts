import TelegramBot from "node-telegram-bot-api";
import type { User, Task } from "../types";
import { DIVISIONS } from "../config";

export function adminMainKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "📋 Topshiriq yuborish" }, { text: "👥 Foydalanuvchilar" }],
      [{ text: "🏢 Bo'lim rahbarlari" }, { text: "✅ Ruxsatlar" }],
      [{ text: "📊 Statistika" }, { text: "📋 Topshiriqlar" }],
      [{ text: "📅 Davomat" }, { text: "🤖 AI Yordamchi" }],
    ],
    resize_keyboard: true,
  };
}

export function divisionHeadMainKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🏢 Ishga keldim" }],
      [{ text: "📋 Topshiriq yuborish" }, { text: "📝 Mening topshiriqlarim" }],
      [{ text: "📊 Statistika" }, { text: "📋 Bo'lim topshiriqlari" }],
      [{ text: "👥 Xodimlarim" }, { text: "📅 Davomat" }],
      [{ text: "🤖 AI Yordamchi" }],
    ],
    resize_keyboard: true,
  };
}

export function employeeMainKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🏢 Ishga keldim" }],
      [{ text: "📝 Mening topshiriqlarim" }, { text: "📊 Statistikam" }],
      [{ text: "🤖 AI Yordamchi" }],
    ],
    resize_keyboard: true,
  };
}

export function aiChatKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🔄 Yangi suhbat" }, { text: "❌ Chiqish" }],
    ],
    resize_keyboard: true,
  };
}

export function divisionsInlineKeyboard(): TelegramBot.InlineKeyboardMarkup {
  const divisionEntries = Object.entries(DIVISIONS);
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let i = 0; i < divisionEntries.length; i += 3) {
    const row = divisionEntries.slice(i, i + 3).map(([id, name]) => ({
      text: name,
      callback_data: `select_division_${id}`,
    }));
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

export function divisionsStatsInlineKeyboard(): TelegramBot.InlineKeyboardMarkup {
  const divisionEntries = Object.entries(DIVISIONS);
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let i = 0; i < divisionEntries.length; i += 3) {
    const row = divisionEntries.slice(i, i + 3).map(([id, name]) => ({
      text: name,
      callback_data: `div_tasks_${id}`,
    }));
    rows.push(row);
  }
  rows.push([{ text: "📊 Umumiy statistika", callback_data: "admin_stats_all" }]);
  return { inline_keyboard: rows };
}

export function usersInlineKeyboard(users: User[], prefix: string): TelegramBot.InlineKeyboardMarkup {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let i = 0; i < users.length; i += 2) {
    const row = users.slice(i, i + 2).map((u) => ({
      text: u.fullName || u.username || u.telegramId,
      callback_data: `${prefix}_${u.telegramId}`,
    }));
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

export function deadlineKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "⏱ 1 soat", callback_data: "deadline_1h" },
        { text: "⏱ 3 soat", callback_data: "deadline_3h" },
        { text: "⏱ 6 soat", callback_data: "deadline_6h" },
      ],
      [
        { text: "📅 1 kun", callback_data: "deadline_1d" },
        { text: "📅 2 kun", callback_data: "deadline_2d" },
        { text: "📅 3 kun", callback_data: "deadline_3d" },
      ],
      [
        { text: "📅 1 hafta", callback_data: "deadline_7d" },
        { text: "✍️ O'zim kiritaman", callback_data: "deadline_custom" },
      ],
    ],
  };
}

export function taskActionsKeyboard(task: Task): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Bajarildi", callback_data: `task_done_${task.id}` }],
    ],
  };
}

export function locationRequestKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "📍 Joylashuvni yuborish", request_location: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export function allowUserInlineKeyboard(telegramId: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Ruxsat berish", callback_data: `allow_user_${telegramId}` },
        { text: "❌ Rad etish", callback_data: `deny_user_${telegramId}` },
      ],
    ],
  };
}

export function pendingUsersListKeyboard(
  users: User[]
): TelegramBot.InlineKeyboardMarkup {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (const u of users) {
    const label = (u.fullName || u.username || u.telegramId).slice(0, 25);
    rows.push([
      { text: `👤 ${label}`, callback_data: "noop" },
      { text: "✅", callback_data: `allow_user_${u.telegramId}` },
      { text: "❌", callback_data: `deny_user_${u.telegramId}` },
    ]);
  }
  return { inline_keyboard: rows };
}

export function approvedUsersListKeyboard(
  users: User[],
  divisions: Record<string, string>
): TelegramBot.InlineKeyboardMarkup {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (const u of users) {
    const roleIcon = u.role === "division_head" ? "👔" : "👤";
    const divName = u.divisionId ? (divisions[u.divisionId] || u.divisionId) : "—";
    const name = (u.fullName || u.username || u.telegramId).slice(0, 20);
    rows.push([
      { text: `${roleIcon} ${name} | ${divName}`, callback_data: "noop" },
      { text: "🗑️ O'chirish", callback_data: `del_user_${u.telegramId}` },
    ]);
  }
  return { inline_keyboard: rows };
}

export function assignRoleKeyboard(telegramId: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "👔 Bo'lim rahbari", callback_data: `role_head_${telegramId}` },
        { text: "👤 Xodim", callback_data: `role_employee_${telegramId}` },
      ],
    ],
  };
}

export function headEmployeesStatsKeyboard(divisionId: string, employees: User[]): TelegramBot.InlineKeyboardMarkup {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let i = 0; i < employees.length; i += 2) {
    const row = employees.slice(i, i + 2).map((u) => ({
      text: u.fullName || u.username || u.telegramId,
      callback_data: `emp_stats_${u.telegramId}`,
    }));
    rows.push(row);
  }
  rows.push([{ text: "📊 Umumiy ko'rinish", callback_data: `head_stats_all` }]);
  return { inline_keyboard: rows };
}
