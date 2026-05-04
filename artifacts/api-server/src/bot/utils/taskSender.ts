import TelegramBot from "node-telegram-bot-api";
import type { Task, MediaType } from "../types";
import * as kb from "./keyboards";

export function extractMedia(msg: TelegramBot.Message): { fileId?: string; mediaType?: MediaType; caption?: string } {
  if (msg.photo) {
    return { fileId: msg.photo[msg.photo.length - 1].file_id, mediaType: "photo", caption: msg.caption };
  }
  if (msg.video) return { fileId: msg.video.file_id, mediaType: "video", caption: msg.caption };
  if (msg.voice) return { fileId: msg.voice.file_id, mediaType: "voice", caption: msg.caption };
  if (msg.audio) return { fileId: msg.audio.file_id, mediaType: "audio", caption: msg.caption };
  if (msg.document) return { fileId: msg.document.file_id, mediaType: "document", caption: msg.caption };
  if (msg.video_note) return { fileId: msg.video_note.file_id, mediaType: "video_note", caption: msg.caption };
  if (msg.animation) return { fileId: msg.animation.file_id, mediaType: "animation", caption: msg.caption };
  if (msg.sticker) return { fileId: msg.sticker.file_id, mediaType: "sticker", caption: msg.caption };
  return {};
}

export function hasMediaContent(msg: TelegramBot.Message): boolean {
  return !!(
    msg.photo || msg.video || msg.voice || msg.audio ||
    msg.document || msg.video_note || msg.animation || msg.sticker || msg.text
  );
}

export async function sendTaskToUser(
  bot: TelegramBot,
  task: Task,
  assignerName: string,
  recipientId: number
): Promise<void> {
  const deadlineStr = task.deadline.toLocaleString("uz-UZ");
  const caption =
    `📋 *Yangi topshiriq!*\n\n` +
    `*${task.title}*\n` +
    (task.description ? `${task.description}\n\n` : "\n") +
    `⏰ Muddat: ${deadlineStr}\n` +
    `👤 Topshirdi: ${assignerName}`;

  const opts: TelegramBot.SendMessageOptions = {
    parse_mode: "Markdown",
    reply_markup: kb.taskActionsKeyboard(task),
  };

  try {
    if (task.mediaFileId && task.mediaType) {
      await sendMediaMessage(bot, recipientId, task.mediaFileId, task.mediaType, caption, opts);
    } else {
      await bot.sendMessage(recipientId, caption, opts);
    }
  } catch (_) {
    await bot.sendMessage(recipientId, caption, opts);
  }
}

async function sendMediaMessage(
  bot: TelegramBot,
  chatId: number,
  fileId: string,
  mediaType: MediaType,
  caption: string,
  opts: TelegramBot.SendMessageOptions
): Promise<void> {
  const mediaOpts = { caption, parse_mode: "Markdown" as const, reply_markup: opts.reply_markup };
  switch (mediaType) {
    case "photo":
      await bot.sendPhoto(chatId, fileId, mediaOpts);
      break;
    case "video":
      await bot.sendVideo(chatId, fileId, mediaOpts);
      break;
    case "voice":
      await bot.sendVoice(chatId, fileId, mediaOpts);
      break;
    case "audio":
      await bot.sendAudio(chatId, fileId, mediaOpts);
      break;
    case "document":
      await bot.sendDocument(chatId, fileId, mediaOpts);
      break;
    case "video_note":
      await bot.sendVideoNote(chatId, fileId);
      await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", reply_markup: opts.reply_markup });
      break;
    case "animation":
      await bot.sendAnimation(chatId, fileId, mediaOpts);
      break;
    case "sticker":
      await bot.sendSticker(chatId, fileId);
      await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", reply_markup: opts.reply_markup });
      break;
    default:
      await bot.sendDocument(chatId, fileId, mediaOpts);
  }
}
