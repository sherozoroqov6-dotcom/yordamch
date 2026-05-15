import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { logger } from "../lib/logger";
import * as store from "./utils/store";
import { DEADLINE_WARNING_MINUTES } from "./config";

// FIX: Track which tasks have already received a deadline warning to prevent
// sending repeated messages every minute for the entire warning window.
const warnedTaskIds = new Set<string>();

export function startScheduler(bot: TelegramBot): void {
  cron.schedule("* * * * *", async () => {
    const now = Date.now();
    const warningMs = DEADLINE_WARNING_MINUTES * 60 * 1000;
    const tasks = store.getAllTasks().filter((t) => t.status !== "completed");

    for (const task of tasks) {
      const timeLeft = task.deadline.getTime() - now;

      if (timeLeft > 0 && timeLeft <= warningMs && !warnedTaskIds.has(task.id)) {
        warnedTaskIds.add(task.id);
        const minutesLeft = Math.round(timeLeft / 60000);
        const warningText = `⚠️ *Muddat eslatmasi!*\n\n📋 *${task.title}*\n${task.description}\n\n⏰ Muddatga ${minutesLeft} daqiqa qoldi!\n⏱ Muddat: ${task.deadline.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`;

        try {
          await bot.sendMessage(Number(task.assignedTo), warningText, { parse_mode: "Markdown" });
        } catch (err) {
          logger.error({ err, taskId: task.id }, "Ijrochiga eslatma yuborishda xato");
        }

        try {
          const adminId = process.env.ADMIN_TELEGRAM_ID!;
          const assignee = store.getUser(task.assignedTo);
          await bot.sendMessage(
            Number(adminId),
            `⚠️ *Muddat eslatmasi!*\n\n📋 *${task.title}*\n👤 Ijrochi: ${assignee?.fullName || task.assignedTo}\n⏰ Muddatga ${minutesLeft} daqiqa qoldi!`,
            { parse_mode: "Markdown" }
          );
        } catch (err) {
          logger.error({ err, taskId: task.id }, "Adminga eslatma yuborishda xato");
        }

        if (task.assignedBy !== process.env.ADMIN_TELEGRAM_ID) {
          try {
            const assigner = store.getUser(task.assignedBy);
            const assignee = store.getUser(task.assignedTo);
            if (assigner) {
              await bot.sendMessage(
                Number(task.assignedBy),
                `⚠️ *Muddat eslatmasi!*\n\n📋 *${task.title}*\n👤 Ijrochi: ${assignee?.fullName || task.assignedTo}\n⏰ Muddatga ${minutesLeft} daqiqa qoldi!`,
                { parse_mode: "Markdown" }
              );
            }
          } catch (err) {
            logger.error({ err, taskId: task.id }, "Topshiriq beruvchiga eslatma yuborishda xato");
          }
        }

        logger.info({ taskId: task.id, minutesLeft }, "Muddat eslatmasi yuborildi");
      }

      if (task.deadline.getTime() < now && task.status === "pending") {
        task.status = "in_progress";
        store.setTask(task);
        // Clean up warning tracker once task is overdue (no longer needs warning)
        warnedTaskIds.delete(task.id);
        try {
          await bot.sendMessage(
            Number(task.assignedTo),
            `🚨 *Muddati o'tdi!*\n\n📋 *${task.title}*\n\nMuddat o'tdi! Iltimos tezda natija kiriting.`,
            { parse_mode: "Markdown" }
          );
        } catch (err) {
          logger.error({ err, taskId: task.id }, "Muddat o'tish xabari yuborishda xato");
        }
      }
    }
  });

  logger.info("Scheduler ishga tushdi");
}
