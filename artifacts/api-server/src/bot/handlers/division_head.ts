import TelegramBot from "node-telegram-bot-api";
import { logger } from "../../lib/logger";
import * as store from "../utils/store";
import * as sheets from "../utils/sheets";
import * as kb from "../utils/keyboards";
import * as statsUtil from "../utils/stats";
import * as ms from "../utils/multiselect";
import * as taskSender from "../utils/taskSender";
import type { Task } from "../types";
import { todayStrUz } from "../utils/time";

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
// When head is in head_task_media state, pressing keyboard buttons (which are
// text messages) would previously pass hasMediaContent() and get saved as the
// task description. We now skip those texts in handleHeadTaskFlow.
const HEAD_KEYBOARD_BUTTONS = new Set([
  "🏢 Ishga keldim",
  "📋 Topshiriq yuborish",
  "📝 Mening topshiriqlarim",
  "📊 Statistika",
  "📋 Bo'lim topshiriqlari",
  "👥 Xodimlarim",
  "📅 Davomat",
  "🤖 AI Yordamchi",
]);

export function registerDivisionHeadHandlers(bot: TelegramBot): void {
  bot.on("message", async (msg) => {
    if (!msg.text || !msg.from) return;
    const id = String(msg.from.id);
    const user = store.getUser(id);
    if (!user || user.role !== "division_head") return;
    const text = msg.text;
    const chatId = msg.chat.id;

    if (text === "📋 Topshiriq yuborish") {
      const employees = store.getUsersByDivision(user.divisionId || "");
      if (!employees.length) {
        await bot.sendMessage(chatId, "Bo'limingizda hali xodimlar yo'q.");
        return;
      }
      store.setSession(id, { state: "head_select_employees", data: { selectedIds: [] } });
      await bot.sendMessage(
        chatId,
        "📋 Topshiriq beriladigan xodimlarni tanlang (bir yoki bir nechtasini):",
        { reply_markup: ms.buildMultiSelectKeyboard(employees, [], "htoggle", "head_confirm_employees") }
      );

    } else if (text === "📝 Mening topshiriqlarim") {
      const active = store.getAllTasks().filter((t) => t.assignedTo === id && t.status !== "completed");
      const done = store.getAllTasks().filter((t) => t.assignedTo === id && t.status === "completed");
      if (!active.length && !done.length) {
        await bot.sendMessage(chatId, "Hozircha topshiriqlar yo'q. 🎉");
        return;
      }
      if (active.length) {
        await bot.sendMessage(chatId, "⏳ *Faol topshiriqlar:*", { parse_mode: "Markdown" });
        for (const task of active) {
          const rem = Math.round((task.deadline.getTime() - Date.now()) / 60000);
          const remTxt = rem > 0 ? `${rem} daqiqa qoldi` : "🚨 Muddat o'tdi!";
          await bot.sendMessage(
            chatId,
            `📋 *${task.title}*\n${task.description}\n\n⏰ ${task.deadline.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })} (${remTxt})`,
            { parse_mode: "Markdown", reply_markup: kb.taskActionsKeyboard(task) }
          );
        }
      }
      if (done.length) {
        let txt = `\n✅ *Bajarilgan (${done.length}):*\n\n`;
        for (const t of done.slice(-5)) txt += `✅ *${t.title}* — ${t.completedAt?.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" }) || "-"}\n`;
        await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
      }

    } else if (text === "📊 Statistika") {
      await bot.sendMessage(chatId, statsUtil.getHeadStats(id), { parse_mode: "Markdown" });
      const employees = store.getUsersByDivision(user.divisionId || "");
      if (employees.length) {
        await bot.sendMessage(chatId, "Xodim statistikasini ko'rish uchun tanlang:", {
          reply_markup: kb.headEmployeesStatsKeyboard(user.divisionId || "", employees),
        });
      }

    } else if (text === "📋 Bo'lim topshiriqlari") {
      for (const part of splitMsg(statsUtil.getHeadAllTasks(id))) {
        await bot.sendMessage(chatId, part, { parse_mode: "Markdown" });
      }

    } else if (text === "👥 Xodimlarim") {
      const employees = store.getUsersByDivision(user.divisionId || "");
      if (!employees.length) { await bot.sendMessage(chatId, "Bo'limingizda hali xodimlar yo'q."); return; }
      let txt = "👥 *Xodimlar ro'yxati:*\n\n";
      for (const e of employees) {
        const att = store.getTodayAttendance(e.telegramId);
        const attTxt = att ? `✅ ${att.checkInTime}${att.isLate ? " ⚠️" : ""}` : "❌ Kelmagan";
        const tasks = store.getAllTasks().filter((t) => t.assignedTo === e.telegramId && t.status !== "completed");
        txt += `• *${e.fullName || e.username}*\n  Davomat: ${attTxt} | Faol: ${tasks.length} topshiriq\n\n`;
      }
      await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });

    } else if (text === "📅 Davomat") {
      const employees = store.getUsersByDivision(user.divisionId || "");
      const today = todayStrUz();
      let report = `📅 *Bugungi davomat (${today}):*\n\n`;
      const myAtt = store.getTodayAttendance(id);
      report += `👔 *${user.fullName || user.username} (Rahbar):* ${myAtt ? `✅ ${myAtt.checkInTime}${myAtt.isLate ? " ⚠️ Kech" : ""}` : "❌ Kelmagan"}\n\n👥 *Xodimlar:*\n`;
      for (const e of employees) {
        const att = store.getTodayAttendance(e.telegramId);
        report += att ? `✅ ${e.fullName || e.username} — ${att.checkInTime}${att.isLate ? " ⚠️ Kech" : ""}\n` : `❌ ${e.fullName || e.username} — Kelmagan\n`;
      }
      await bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
    }
  });

  bot.on("callback_query", async (query) => {
    if (!query.from || !query.data || !query.message) return;
    const id = String(query.from.id);
    const user = store.getUser(id);
    if (!user || user.role !== "division_head") return;
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const session = store.getSession(id);

    if (data === "noop") { await bot.answerCallbackQuery(query.id, { text: "Avval kamida 1 xodim tanlang." }); return; }
    await bot.answerCallbackQuery(query.id);

    // --- Multi-select toggle employee ---
    if (data.startsWith("htoggle_") && session.state === "head_select_employees") {
      const targetId = data.replace("htoggle_", "");
      const selected = ((session.data?.selectedIds as string[]) || []);
      const updated = selected.includes(targetId)
        ? selected.filter((x) => x !== targetId)
        : [...selected, targetId];
      store.setSession(id, { ...session, data: { ...session.data, selectedIds: updated } });
      const employees = store.getUsersByDivision(user.divisionId || "");
      await bot.editMessageReplyMarkup(
        ms.buildMultiSelectKeyboard(employees, updated, "htoggle", "head_confirm_employees"),
        { chat_id: chatId, message_id: msgId }
      );
      return;
    }

    // --- Confirm employee selection → ask content directly ---
    if (data === "head_confirm_employees" && session.state === "head_select_employees") {
      const selectedIds = (session.data?.selectedIds as string[]) || [];
      if (!selectedIds.length) return;
      store.setSession(id, { state: "head_task_media", data: { selectedIds } });
      await bot.sendMessage(
        chatId,
        "📎 Topshiriq mazmunini yuboring:\n\n_Matn, rasm, video, ovozli xabar, fayl, yoki boshqa media format — barchasi qabul qilinadi._",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // --- Deadline ---
    if (data.startsWith("deadline_") && session.state === "head_task_deadline") {
      const part = data.replace("deadline_", "");
      if (part === "custom") {
        store.setSession(id, { ...session, state: "head_task_custom_deadline" });
        await bot.sendMessage(chatId, "Muddatni kiriting (masalan: 25.01.2025 18:00):");
        return;
      }
      const deadline = computeDeadline(part);
      await createAndSendTasks(bot, id, chatId, session, deadline);
      return;
    }

    // --- Stats ---
    if (data === "head_stats_all") {
      await bot.sendMessage(chatId, statsUtil.getHeadStats(id), { parse_mode: "Markdown" });
      return;
    }
    if (data.startsWith("emp_stats_")) {
      const empId = data.replace("emp_stats_", "");
      await bot.sendMessage(chatId, statsUtil.getEmployeeStats(empId), { parse_mode: "Markdown" });
      const empTasks = store.getAllTasks().filter((t) => t.assignedTo === empId && t.status !== "completed");
      if (empTasks.length) {
        let txt = "📋 *Faol topshiriqlar:*\n\n";
        for (const t of empTasks) txt += statsUtil.formatTaskLine(t) + "\n";
        await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
      }
    }
  });
}

export async function handleHeadTaskFlow(bot: TelegramBot, msg: TelegramBot.Message): Promise<boolean> {
  if (!msg.from) return false;
  const id = String(msg.from.id);
  const user = store.getUser(id);
  if (!user || user.role !== "division_head") return false;
  const session = store.getSession(id);
  const chatId = msg.chat.id;
  if (!session.state?.startsWith("head_task")) return false;

  // FIX: If the head pressed a keyboard button while in task flow, do not treat
  // the button label as task content. The keyboard handler already ran; bail here.
  if (msg.text && HEAD_KEYBOARD_BUTTONS.has(msg.text)) return false;

  if (session.state === "head_task_media" && taskSender.hasMediaContent(msg)) {
    const { fileId, mediaType, caption } = taskSender.extractMedia(msg);
    const description = msg.text || caption || "";
    store.setSession(id, {
      ...session,
      state: "head_task_deadline",
      data: { ...session.data, description, mediaFileId: fileId || "", mediaType: mediaType || "" },
    });
    await bot.sendMessage(chatId, "⏰ Topshiriq muddatini tanlang:", { reply_markup: kb.deadlineKeyboard() });
    return true;
  }

  if (session.state === "head_task_custom_deadline" && msg.text) {
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
  headId: string,
  chatId: number,
  session: ReturnType<typeof store.getSession>,
  deadline: Date
): Promise<void> {
  const data = session.data as Record<string, unknown>;
  const selectedIds = (data.selectedIds as string[]) || [];
  const headUser = store.getUser(headId);
  const assignerName = headUser?.fullName || "Rahbar";

  store.clearSession(headId);

  const description = (data.description as string) || "";
  const autoTitle = description.split("\n")[0].slice(0, 60) || "Topshiriq";

  let sent = 0;
  for (const empId of selectedIds) {
    const task: Task = {
      id: store.generateId(),
      title: autoTitle,
      description,
      assignedTo: empId,
      assignedBy: headId,
      deadline,
      status: "pending",
      createdAt: new Date(),
      level: "head_to_employee",
      divisionId: headUser?.divisionId,
      mediaFileId: (data.mediaFileId as string) || undefined,
      mediaType: (data.mediaType as Task["mediaType"]) || undefined,
    };

    store.setTask(task);
    const assigneeUser = store.getUser(empId);
    await sheets.saveTask(task, assigneeUser?.fullName || empId, assignerName);
    await taskSender.sendTaskToUser(bot, task, assignerName, Number(empId));
    sent++;
    logger.info({ taskId: task.id, assignedTo: empId }, "Rahbar topshirig'i yuborildi");
  }

  await bot.sendMessage(
    chatId,
    `✅ Topshiriq *${sent}* ta xodimga yuborildi!\n\n📋 *${autoTitle}*\n⏰ Muddat: ${deadline.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`,
    { parse_mode: "Markdown" }
  );
}
