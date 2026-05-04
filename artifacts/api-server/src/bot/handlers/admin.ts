import TelegramBot from "node-telegram-bot-api";
import { logger } from "../../lib/logger";
import * as store from "../utils/store";
import * as sheets from "../utils/sheets";
import * as kb from "../utils/keyboards";
import * as statsUtil from "../utils/stats";
import * as ms from "../utils/multiselect";
import * as taskSender from "../utils/taskSender";
import { DIVISIONS } from "../config";
import type { Task } from "../types";

const MAX_MSG_LEN = 4000;

function splitMsg(text: string): string[] {
  const parts: string[] = [];
  while (text.length > MAX_MSG_LEN) {
    const idx = text.lastIndexOf("\n", MAX_MSG_LEN);
    parts.push(text.slice(0, idx > 0 ? idx : MAX_MSG_LEN));
    text = text.slice(idx > 0 ? idx + 1 : MAX_MSG_LEN);
  }
  if (text.trim()) parts.push(text);
  return parts;
}

// FIX: Set of keyboard button texts that should NOT be treated as task content.
// When admin is in admin_task_media state, pressing keyboard buttons (which are
// text messages) would previously pass hasMediaContent() and get saved as the
// task description. We now skip those texts in handleAdminTaskFlow.
const ADMIN_KEYBOARD_BUTTONS = new Set([
  "📋 Topshiriq yuborish",
  "👥 Foydalanuvchilar",
  "🏢 Bo'lim rahbarlari",
  "✅ Ruxsatlar",
  "📊 Statistika",
  "📋 Topshiriqlar",
  "📅 Davomat",
  "🤖 AI Yordamchi",
]);

export function registerAdminHandlers(bot: TelegramBot): void {
  bot.on("message", async (msg) => {
    if (!msg.from) return;
    const id = String(msg.from.id);
    const user = store.getUser(id);
    if (!user || user.role !== "admin") return;
    const text = msg.text || "";
    const chatId = msg.chat.id;

    if (text === "📋 Topshiriq yuborish") {
      const heads = store.getDivisionHeads();
      if (!heads.length) {
        await bot.sendMessage(chatId, "Hali bo'lim rahbarlari tayinlanmagan. Avval 🏢 Bo'lim rahbarlari bo'limiga o'ting.");
        return;
      }
      store.setSession(id, { state: "admin_select_heads", data: { selectedIds: [] } });
      await bot.sendMessage(
        chatId,
        "📋 Topshiriq beriladigan bo'lim rahbarlarini tanlang (bir yoki bir nechtasini):",
        { reply_markup: ms.buildMultiSelectKeyboard(heads, [], "atoggle", "admin_confirm_heads") }
      );

    } else if (text === "👥 Foydalanuvchilar") {
      const allUsers = store.getAllUsers().filter((u) => u.role !== "admin");
      if (!allUsers.length) { await bot.sendMessage(chatId, "Hozircha foydalanuvchilar yo'q."); return; }
      let txt = "👥 *Foydalanuvchilar ro'yxati:*\n\n";
      for (const u of allUsers) {
        const divName = u.divisionId ? DIVISIONS[u.divisionId] || u.divisionId : "-";
        txt += `• ${u.fullName || u.username} \`${u.telegramId}\`\n`;
        txt += `  ${u.role === "division_head" ? "👔 Rahbar" : "👤 Xodim"} | 🏢 ${divName}\n\n`;
      }
      await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });

    } else if (text === "🏢 Bo'lim rahbarlari") {
      store.setSession(id, { state: "admin_assign_head_division" });
      await bot.sendMessage(chatId, "Qaysi bo'limga rahbar tayinlaysiz?", { reply_markup: kb.divisionsInlineKeyboard() });

    } else if (text === "✅ Ruxsatlar") {
      const pending = store.getAllUsers().filter((u) => !u.isAllowed);
      if (!pending.length) { await bot.sendMessage(chatId, "Barcha foydalanuvchilarga ruxsat berilgan yoki so'rov yo'q."); return; }
      for (const u of pending) {
        await bot.sendMessage(
          chatId,
          `👤 *${u.fullName || u.username}*\nID: \`${u.telegramId}\` | @${u.username || "-"}`,
          { parse_mode: "Markdown", reply_markup: kb.allowUserInlineKeyboard(u.telegramId) }
        );
      }

    } else if (text === "📊 Statistika") {
      const statsText = statsUtil.getAdminDivisionStats();
      for (const part of splitMsg(statsText)) await bot.sendMessage(chatId, part, { parse_mode: "Markdown" });

    } else if (text === "📋 Topshiriqlar") {
      await bot.sendMessage(chatId, "Qaysi bo'lim topshiriqlarini ko'rmoqchisiz?", { reply_markup: kb.divisionsStatsInlineKeyboard() });

    } else if (text === "📅 Davomat") {
      const today = new Date().toLocaleDateString("uz-UZ");
      const heads = store.getDivisionHeads();
      let report = `📅 *Bugungi davomat (${today}):*\n\n`;
      for (const head of heads) {
        const divName = head.divisionId ? DIVISIONS[head.divisionId] : "?";
        const employees = store.getUsersByDivision(head.divisionId || "");
        report += `🏢 *${divName}*\n`;
        const ha = store.getTodayAttendance(head.telegramId);
        report += `  👔 ${head.fullName || head.username}: ${ha ? `✅ ${ha.checkInTime}${ha.isLate ? " ⚠️" : ""}` : "❌ Kelmagan"}\n`;
        for (const emp of employees) {
          const att = store.getTodayAttendance(emp.telegramId);
          report += `  👤 ${emp.fullName || emp.username}: ${att ? `✅ ${att.checkInTime}${att.isLate ? " ⚠️" : ""}` : "❌ Kelmagan"}\n`;
        }
        report += "\n";
      }
      for (const part of splitMsg(report)) await bot.sendMessage(chatId, part, { parse_mode: "Markdown" });
    }
  });

  bot.on("callback_query", async (query) => {
    if (!query.from || !query.data || !query.message) return;
    const id = String(query.from.id);
    const user = store.getUser(id);
    if (!user || user.role !== "admin") return;
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const session = store.getSession(id);

    if (data === "noop") { await bot.answerCallbackQuery(query.id, { text: "Avval kamida 1 kishi tanlang." }); return; }
    await bot.answerCallbackQuery(query.id);

    // --- Multi-select: toggle head ---
    if (data.startsWith("atoggle_") && session.state === "admin_select_heads") {
      const targetId = data.replace("atoggle_", "");
      const selected = ((session.data?.selectedIds as string[]) || []);
      const updated = selected.includes(targetId)
        ? selected.filter((x) => x !== targetId)
        : [...selected, targetId];
      store.setSession(id, { ...session, data: { ...session.data, selectedIds: updated } });
      const heads = store.getDivisionHeads();
      await bot.editMessageReplyMarkup(
        ms.buildMultiSelectKeyboard(heads, updated, "atoggle", "admin_confirm_heads"),
        { chat_id: chatId, message_id: msgId }
      );
      return;
    }

    // --- Confirm head selection → ask content directly ---
    if (data === "admin_confirm_heads" && session.state === "admin_select_heads") {
      const selectedIds = (session.data?.selectedIds as string[]) || [];
      if (!selectedIds.length) return;
      store.setSession(id, { state: "admin_task_media", data: { selectedIds } });
      await bot.sendMessage(
        chatId,
        "📎 Topshiriq mazmunini yuboring:\n\n_Matn, rasm, video, ovozli xabar, fayl, yoki boshqa media format — barchasi qabul qilinadi._",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // --- Deadline selection ---
    if (data.startsWith("deadline_") && session.state === "admin_task_deadline") {
      const deadlinePart = data.replace("deadline_", "");
      if (deadlinePart === "custom") {
        store.setSession(id, { ...session, state: "admin_task_custom_deadline" });
        await bot.sendMessage(chatId, "Muddatni kiriting (masalan: 25.01.2025 18:00):");
        return;
      }
      const deadline = computeDeadline(deadlinePart);
      await createAndSendTasks(bot, id, chatId, session, deadline);
      return;
    }

    // --- Stats ---
    if (data === "admin_stats_all") {
      const statsText = statsUtil.getAdminDivisionStats();
      for (const part of splitMsg(statsText)) await bot.sendMessage(chatId, part, { parse_mode: "Markdown" });
      return;
    }
    if (data.startsWith("div_tasks_")) {
      const divId = data.replace("div_tasks_", "");
      const { text } = statsUtil.getAdminDivisionTasks(divId);
      for (const part of splitMsg(text)) await bot.sendMessage(chatId, part, { parse_mode: "Markdown" });
      return;
    }

    // --- User approval ---
    if (data.startsWith("allow_user_")) {
      const targetId = data.replace("allow_user_", "");
      const targetUser = store.getUser(targetId);
      if (!targetUser) return;
      targetUser.isAllowed = true;
      store.setUser(targetUser);
      await sheets.saveUser(targetUser);
      await bot.sendMessage(chatId, `✅ ${targetUser.fullName || targetUser.username} ga ruxsat berildi.`);
      await bot.sendMessage(Number(targetId), "✅ Sizga botdan foydalanish ruxsati berildi!\n\n/start bosing.");
      return;
    }
    if (data.startsWith("deny_user_")) {
      const targetId = data.replace("deny_user_", "");
      const targetUser = store.getUser(targetId);
      if (!targetUser) return;
      store.removeUser(targetId);
      await bot.sendMessage(chatId, `❌ ${targetUser.fullName || targetUser.username} rad etildi.`);
      await bot.sendMessage(Number(targetId), "❌ Sizning so'rovingiz rad etildi.");
      return;
    }

    // --- Assign division head ---
    if (data.startsWith("select_division_") && session.state === "admin_assign_head_division") {
      const divId = data.replace("select_division_", "");
      store.setSession(id, { state: "admin_assign_head_user", data: { divisionId: divId } });
      const allUsers = store.getAllUsers().filter((u) => u.role !== "admin");
      if (!allUsers.length) { await bot.sendMessage(chatId, "Hozircha foydalanuvchilar yo'q."); return; }
      await bot.sendMessage(chatId, `${DIVISIONS[divId]} bo'limiga rahbar tanlang:`, { reply_markup: kb.usersInlineKeyboard(allUsers, "head") });
      return;
    }
    if (data.startsWith("head_") && session.state === "admin_assign_head_user") {
      const headId = data.replace("head_", "");
      const divId = (session.data?.divisionId as string) || "";
      store.setDivisionHead(divId, headId);
      const headUser = store.getUser(headId);
      if (headUser) await sheets.saveUser(headUser);
      await bot.sendMessage(chatId, `✅ ${headUser?.fullName || headId} — ${DIVISIONS[divId]} rahbari tayinlandi.`);
      await bot.sendMessage(Number(headId), `✅ Siz ${DIVISIONS[divId]} rahbari qilib tayinlandingiz!`, { reply_markup: kb.divisionHeadMainKeyboard() });
      store.clearSession(id);
      return;
    }

    // --- role_head / assign_div (from /start new-user approval flow) ---
    if (data.startsWith("role_head_")) {
      const targetId = data.replace("role_head_", "");
      const targetUser = store.getUser(targetId);
      if (!targetUser) return;
      if (!targetUser.isAllowed) { targetUser.isAllowed = true; store.setUser(targetUser); }
      const divisionButtons = Object.entries(DIVISIONS).map(([divId, divName]) => ([
        { text: divName, callback_data: `assign_div_${targetId}__${divId}` },
      ]));
      await bot.sendMessage(chatId, `${targetUser.fullName || targetUser.username} uchun bo'lim tanlang:`, { reply_markup: { inline_keyboard: divisionButtons } });
      return;
    }
    if (data.startsWith("assign_div_")) {
      const rest = data.replace("assign_div_", "");
      const sepIdx = rest.indexOf("__");
      if (sepIdx === -1) return;
      const targetId = rest.slice(0, sepIdx);
      const divId = rest.slice(sepIdx + 2);
      store.setDivisionHead(divId, targetId);
      const headUser = store.getUser(targetId);
      if (headUser) await sheets.saveUser(headUser);
      await bot.sendMessage(chatId, `✅ ${headUser?.fullName || targetId} — ${DIVISIONS[divId]} rahbari tayinlandi.`);
      await bot.sendMessage(Number(targetId), `✅ Siz ${DIVISIONS[divId]} rahbari qilib tayinlandingiz!\n\nIltimos /start bosing.`);
    }
  });
}

// --- Flow handler (called from bot index for every message) ---
export async function handleAdminTaskFlow(bot: TelegramBot, msg: TelegramBot.Message): Promise<boolean> {
  if (!msg.from) return false;
  const id = String(msg.from.id);
  const user = store.getUser(id);
  if (!user || user.role !== "admin") return false;
  const session = store.getSession(id);
  const chatId = msg.chat.id;
  if (!session.state?.startsWith("admin_task")) return false;

  // FIX: If the admin pressed a keyboard button while in task flow, do not treat
  // the button label as task content. The keyboard handler already ran and cleared
  // or updated the session; just bail out here.
  if (msg.text && ADMIN_KEYBOARD_BUTTONS.has(msg.text)) return false;

  if (session.state === "admin_task_media" && taskSender.hasMediaContent(msg)) {
    const { fileId, mediaType, caption } = taskSender.extractMedia(msg);
    const description = msg.text || caption || "";
    store.setSession(id, {
      ...session,
      state: "admin_task_deadline",
      data: { ...session.data, description, mediaFileId: fileId || "", mediaType: mediaType || "" },
    });
    await bot.sendMessage(chatId, "⏰ Topshiriq muddatini tanlang:", { reply_markup: kb.deadlineKeyboard() });
    return true;
  }

  if (session.state === "admin_task_custom_deadline" && msg.text) {
    const deadline = parseDeadline(msg.text);
    if (!deadline) {
      await bot.sendMessage(chatId, "❌ Noto'g'ri format. Qayta kiriting (masalan: 25.01.2025 18:00):");
      return true;
    }
    await createAndSendTasks(bot, id, chatId, session, deadline);
    return true;
  }

  return false;
}

function computeDeadline(part: string): Date {
  const d = new Date();
  if (part === "1h") d.setHours(d.getHours() + 1);
  else if (part === "3h") d.setHours(d.getHours() + 3);
  else if (part === "6h") d.setHours(d.getHours() + 6);
  else if (part === "1d") d.setDate(d.getDate() + 1);
  else if (part === "2d") d.setDate(d.getDate() + 2);
  else if (part === "3d") d.setDate(d.getDate() + 3);
  else if (part === "7d") d.setDate(d.getDate() + 7);
  return d;
}

function parseDeadline(text: string): Date | null {
  const parts = text.trim().split(/[\s,]+/);
  if (parts.length < 2) return null;
  const [datePart, timePart] = parts;
  const [day, month, year] = datePart.split(".").map(Number);
  const [hours, minutes] = timePart.split(":").map(Number);
  const d = new Date(year, month - 1, day, hours, minutes);
  return isNaN(d.getTime()) ? null : d;
}

async function createAndSendTasks(
  bot: TelegramBot,
  adminId: string,
  chatId: number,
  session: ReturnType<typeof store.getSession>,
  deadline: Date
): Promise<void> {
  const data = session.data as Record<string, unknown>;
  const selectedIds = (data.selectedIds as string[]) || [];
  const adminUser = store.getUser(adminId);
  const assignerName = adminUser?.fullName || "Admin";

  store.clearSession(adminId);

  const description = (data.description as string) || "";
  const autoTitle = description.split("\n")[0].slice(0, 60) || "Topshiriq";

  let sent = 0;
  for (const headId of selectedIds) {
    const task: Task = {
      id: store.generateId(),
      title: autoTitle,
      description,
      assignedTo: headId,
      assignedBy: adminId,
      deadline,
      status: "pending",
      createdAt: new Date(),
      level: "admin_to_head",
      divisionId: store.getUser(headId)?.divisionId,
      mediaFileId: (data.mediaFileId as string) || undefined,
      mediaType: (data.mediaType as Task["mediaType"]) || undefined,
    };

    store.setTask(task);
    const assigneeUser = store.getUser(headId);
    await sheets.saveTask(task, assigneeUser?.fullName || headId, assignerName);
    await taskSender.sendTaskToUser(bot, task, assignerName, Number(headId));
    sent++;
    logger.info({ taskId: task.id, assignedTo: headId }, "Admin topshirig'i yuborildi");
  }

  await bot.sendMessage(
    chatId,
    `✅ Topshiriq *${sent}* ta bo'lim rahbariga yuborildi!\n\n📋 *${autoTitle}*\n⏰ Muddat: ${deadline.toLocaleString("uz-UZ")}`,
    { parse_mode: "Markdown" }
  );
}
