import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import { initSheets, loadUsersFromSheets, loadTasksFromSheets } from "./utils/sheets";
import * as store from "./utils/store";
import { registerCommonHandlers } from "./handlers/common";
import { registerAdminHandlers, handleAdminTaskFlow } from "./handlers/admin";
import { registerDivisionHeadHandlers, handleHeadTaskFlow } from "./handlers/division_head";
import { registerEmployeeHandlers } from "./handlers/employee";
import { registerAIAssistantHandlers } from "./handlers/ai_assistant";
import { startScheduler } from "./scheduler";

export async function startBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN muhit o'zgaruvchisi yo'q!");
  }

  await initSheets();

  const [savedUsers, savedTasks] = await Promise.all([
    loadUsersFromSheets(),
    loadTasksFromSheets(),
  ]);

  for (const user of savedUsers) {
    store.setUser(user);
  }

  for (const user of savedUsers) {
    if (user.role === "division_head" && user.divisionId) {
      store.setDivisionHeadFromLoad(user.divisionId, user.telegramId);
    }
  }

  for (const task of savedTasks) {
    if (task.status !== "completed") {
      store.setTask(task);
    }
  }

  logger.info(
    { users: savedUsers.length, tasks: savedTasks.filter(t => t.status !== "completed").length },
    "Ma'lumotlar qayta yuklandi"
  );

  const bot = new TelegramBot(token, { polling: true });

  registerCommonHandlers(bot);
  registerAIAssistantHandlers(bot);
  registerAdminHandlers(bot);
  registerDivisionHeadHandlers(bot);
  registerEmployeeHandlers(bot);

  bot.on("message", async (msg) => {
    if (!msg.from) return;
    const handled = await handleAdminTaskFlow(bot, msg);
    if (handled) return;
    await handleHeadTaskFlow(bot, msg);
  });

  startScheduler(bot);

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling xato");
  });

  logger.info("Telegram bot ishga tushdi");
}
