import TelegramBot from "node-telegram-bot-api";
import { logger } from "../../lib/logger";
import * as store from "../utils/store";
import * as sheets from "../utils/sheets";
import * as kb from "../utils/keyboards";
import * as statsUtil from "../utils/stats";
import * as taskSender from "../utils/taskSender";
import * as geo from "../utils/geo";
import { WORK_START_HOUR, WORK_START_MINUTE } from "../config";
import type { Attendance, MediaType } from "../types";

// FIX: Escape Markdown special characters in user-provided strings.
// Addresses from reverse geocoding and usernames can contain characters like
// _ * ` [ ] that break Telegram's Markdown parser, causing the sendMessage to
// throw a 400 error which previously crashed the location check-in handler.
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[\]])/g, "\\$1");
}

export function registerEmployeeHandlers(bot: TelegramBot): void {
  bot.on("message", async (msg) => {
    if (!msg.from) return;
    const id = String(msg.from.id);
    const user = store.getUser(id);
    if (!user || (user.role !== "employee" && user.role !== "division_head")) return;
    const chatId = msg.chat.id;
    const session = store.getSession(id);

    if (msg.text === "🏢 Ishga keldim") {
      const existing = store.getTodayAttendance(id);
      if (existing) {
        await bot.sendMessage(chatId, `✅ Siz bugun allaqachon qayd etilgansiz (${existing.checkInTime}).`);
        return;
      }
      store.setSession(id, { state: "employee_location" });
      await bot.sendMessage(chatId, "📍 Joylashuvingizni yuboring:", {
        reply_markup: kb.locationRequestKeyboard(),
      });
      return;
    }

    // FIX: Location messages have no msg.text. This check MUST come before any
    // msg.text-only checks to ensure location messages are always handled.
    if (msg.location && session.state === "employee_location") {
      const now = new Date();
      const checkInTime = now.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
      const today = now.toLocaleDateString("uz-UZ");
      const workStart = new Date(now);
      workStart.setHours(WORK_START_HOUR, WORK_START_MINUTE, 0, 0);
      const isLate = now > workStart;

      const lat = msg.location.latitude;
      const lon = msg.location.longitude;
      const distance = geo.distanceFromWork(lat, lon);
      const outside = !geo.isAtWork(lat, lon);

      let address = "";
      if (outside) {
        await bot.sendMessage(chatId, "⏳ Joylashuv aniqlanmoqda...");
        address = await geo.reverseGeocode(lat, lon);
      }

      const attendance: Attendance = {
        telegramId: id,
        date: today,
        checkInTime,
        latitude: lat,
        longitude: lon,
        isLate,
        distanceFromWork: distance,
        address,
        isOutside: outside,
      };

      store.setTodayAttendance(attendance);
      await sheets.saveAttendance(attendance);
      store.clearSession(id);

      const lateMsg = isLate ? "\n⚠️ Siz ishga kech qoldingiz!" : "\n✅ O'z vaqtida keldingiz!";
      const mapsLink = geo.googleMapsLink(lat, lon);

      // FIX: Escape the address (from reverse geocoding) and other dynamic
      // strings before embedding them in a Markdown message. Unescaped
      // underscores, asterisks, backticks and brackets cause Telegram's parser
      // to reject the message with a 400 error, making location check-in appear
      // "not working" to the user.
      let locationMsg = "";
      if (outside) {
        locationMsg =
          `\n\n📍 *Joylashuv:* Ish joyidan tashqarida\\!\n` +
          `📏 Masofa: *${distance} metr*\n` +
          `🗺 Manzil: ${escapeMarkdown(address)}\n` +
          `🔗 [Google Maps da ko'rish](${mapsLink})`;
      } else {
        locationMsg = `\n\n✅ Joylashuv: Ish joyi (${distance} metr)`;
      }

      const mainKb = user.role === "division_head"
        ? kb.divisionHeadMainKeyboard()
        : kb.employeeMainKeyboard();

      await bot.sendMessage(
        chatId,
        `✅ Kelishingiz qayd etildi\\!\n\n🕐 Vaqt: ${checkInTime}\n📅 Sana: ${today}${lateMsg}`,
        { parse_mode: "Markdown", disable_web_page_preview: true, reply_markup: mainKb }
      );

      // Notify admin & division head
      const lateText = `⚠️ *Kech qolish\\!*\n\n👤 ${escapeMarkdown(user.fullName || user.username)}\n🕐 Keldi: ${checkInTime}\n📅 ${today}`;
      const outsideText =
        `🚨 *Tashqaridan qayd etdi\\!*\n\n` +
        `👤 ${escapeMarkdown(user.fullName || user.username)}\n` +
        `🕐 Keldi: ${checkInTime}\n📅 ${today}\n\n` +
        `📏 Masofa: *${distance} metr*\n` +
        `🗺 Manzil: ${escapeMarkdown(address)}\n` +
        `🔗 [Google Maps](${mapsLink})`;

      const adminId = Number(process.env.ADMIN_TELEGRAM_ID!);
      const headUsers = store.getDivisionHeads().filter((h) => h.divisionId === user.divisionId);
      const notifyIds = [adminId, ...headUsers.map((h) => Number(h.telegramId))].filter(
        (nid) => nid !== Number(id)
      );

      for (const nid of notifyIds) {
        try {
          if (outside) {
            await bot.sendMessage(nid, outsideText, {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            });
          } else if (isLate) {
            await bot.sendMessage(nid, lateText, { parse_mode: "Markdown" });
          }
        } catch (_) {}
      }

      logger.info({ telegramId: id, isLate, distance, outside }, "Davomat qayd etildi");
      return;
    }

    // Only employee role below this point
    if (user.role !== "employee") return;

    if (msg.text === "📝 Mening topshiriqlarim") {
      const myTasks = store.getAllTasks().filter((t) => t.assignedTo === id && t.status !== "completed");
      const completedTasks = store.getAllTasks().filter((t) => t.assignedTo === id && t.status === "completed");

      if (!myTasks.length && !completedTasks.length) {
        await bot.sendMessage(chatId, "Hozircha topshiriqlar yo'q. 🎉");
        return;
      }
      if (myTasks.length) {
        await bot.sendMessage(chatId, "⏳ *Faol topshiriqlar:*", { parse_mode: "Markdown" });
        for (const task of myTasks) {
          const remaining = Math.round((task.deadline.getTime() - Date.now()) / 60000);
          const remainText = remaining <= 0 ? "🚨 Muddat o'tdi!" : `${remaining} daqiqa qoldi`;
          await bot.sendMessage(
            chatId,
            `📋 *${task.title}*\n${task.description}\n\n⏰ ${task.deadline.toLocaleString("uz-UZ")} (${remainText})`,
            { parse_mode: "Markdown", reply_markup: kb.taskActionsKeyboard(task) }
          );
        }
      }
      if (completedTasks.length) {
        let doneText = `\n✅ *Bajarilgan topshiriqlar (${completedTasks.length}):*\n\n`;
        for (const task of completedTasks.slice(-5)) {
          doneText += `✅ *${task.title}*\n   ${task.completedAt?.toLocaleString("uz-UZ") || "-"}\n\n`;
        }
        await bot.sendMessage(chatId, doneText, { parse_mode: "Markdown" });
      }
      return;
    }

    if (msg.text === "📊 Statistikam") {
      await bot.sendMessage(chatId, statsUtil.getEmployeeStats(id), { parse_mode: "Markdown" });
      return;
    }

    // --- Task result: accept ANY media format ---
    if (session.state === "employee_task_result" && taskSender.hasMediaContent(msg)) {
      const taskId = session.data?.taskId as string;
      const task = store.getTask(taskId);
      if (!task) return;

      const { fileId, mediaType, caption } = taskSender.extractMedia(msg);

      task.status = "completed";
      task.completedAt = new Date();
      task.result = msg.text || caption || "Media yuborildi";
      task.resultFileId = fileId;
      task.resultMediaType = mediaType as MediaType | undefined;

      store.setTask(task);
      const assigneeName = user.fullName || user.username || id;
      const assignerName = store.getUser(task.assignedBy)?.fullName || "Noma'lum";
      await sheets.saveTask(task, assigneeName, assignerName);
      store.clearSession(id);

      await bot.sendMessage(chatId, "✅ Topshiriq bajarildi deb belgilandi!", {
        reply_markup: kb.employeeMainKeyboard(),
      });

      const resultCaption =
        `✅ *Topshiriq bajarildi\\!*\n\n` +
        `📋 *${escapeMarkdown(task.title)}*\n` +
        `👤 Ijrochi: ${escapeMarkdown(assigneeName)}\n` +
        `🕐 ${task.completedAt.toLocaleString("uz-UZ")}\n\n` +
        `📝 Natija: ${escapeMarkdown(task.result)}`;

      await notifyWithResult(bot, Number(task.assignedBy), task.resultFileId, task.resultMediaType, resultCaption);
      if (task.level === "head_to_employee") {
        await notifyWithResult(bot, Number(process.env.ADMIN_TELEGRAM_ID!), task.resultFileId, task.resultMediaType, resultCaption);
      }
      logger.info({ taskId }, "Topshiriq bajarildi");
    }
  });

  bot.on("callback_query", async (query) => {
    if (!query.from || !query.data || !query.message) return;
    const id = String(query.from.id);
    const user = store.getUser(id);
    if (!user) return;
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data.startsWith("task_done_")) {
      const taskId = data.replace("task_done_", "");
      const task = store.getTask(taskId);
      if (!task || task.assignedTo !== id) {
        await bot.answerCallbackQuery(query.id, { text: "Bu topshiriq sizga tegishli emas." });
        return;
      }
      if (task.status === "completed") {
        await bot.answerCallbackQuery(query.id, { text: "Topshiriq allaqachon bajarilgan." });
        return;
      }
      store.setSession(id, { state: "employee_task_result", data: { taskId } });
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(
        chatId,
        "📎 Topshiriq natijasini yuboring:\n\n_Matn, rasm, video, ovozli xabar, fayl, yoki boshqa media — barchasi qabul qilinadi._",
        { parse_mode: "Markdown" }
      );
    }
  });
}

async function notifyWithResult(
  bot: TelegramBot,
  chatId: number,
  fileId?: string,
  mediaType?: MediaType,
  caption?: string
): Promise<void> {
  if (!caption) return;
  const opts = { parse_mode: "Markdown" as const };
  try {
    if (fileId && mediaType) {
      switch (mediaType) {
        case "photo": await bot.sendPhoto(chatId, fileId, { ...opts, caption }); break;
        case "video": await bot.sendVideo(chatId, fileId, { ...opts, caption }); break;
        case "voice": await bot.sendVoice(chatId, fileId, { ...opts, caption }); break;
        case "audio": await bot.sendAudio(chatId, fileId, { ...opts, caption }); break;
        case "document": await bot.sendDocument(chatId, fileId, { ...opts, caption }); break;
        case "video_note":
          await bot.sendVideoNote(chatId, fileId);
          await bot.sendMessage(chatId, caption, opts);
          break;
        case "animation": await bot.sendAnimation(chatId, fileId, { ...opts, caption }); break;
        case "sticker":
          await bot.sendSticker(chatId, fileId);
          await bot.sendMessage(chatId, caption, opts);
          break;
        default: await bot.sendMessage(chatId, caption, opts);
      }
    } else {
      await bot.sendMessage(chatId, caption, opts);
    }
  } catch (_) {
    try { await bot.sendMessage(chatId, caption); } catch (_2) {}
  }
}
