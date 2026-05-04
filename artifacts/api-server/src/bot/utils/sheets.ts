import { google } from "googleapis";
import { logger } from "../../lib/logger";
import type { User, Task, Attendance, MediaType } from "../types";

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!;
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!;

function getAuth() {
  const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensureSheet(sheets: ReturnType<typeof google.sheets>, sheetName: string): Promise<void> {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const exists = spreadsheet.data.sheets?.some(
      (s) => s.properties?.title === sheetName
    );
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });
      logger.info({ sheetName }, "Sheet yaratildi");
    }
  } catch (err) {
    logger.error({ err, sheetName }, "Sheet tekshirishda xato");
  }
}

export async function initSheets(): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    await ensureSheet(sheets, "Foydalanuvchilar");
    await ensureSheet(sheets, "Topshiriqlar");
    await ensureSheet(sheets, "Davomat");

    const usersHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Foydalanuvchilar!A1:H1",
    });
    if (!usersHeader.data.values?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Foydalanuvchilar!A1",
        valueInputOption: "RAW",
        requestBody: {
          values: [["Telegram ID", "Username", "To'liq ismi", "Rol", "Bo'lim", "Ruxsat", "Qo'shilgan sana", ""]],
        },
      });
    }

    const tasksHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Topshiriqlar!A1:N1",
    });
    if (!tasksHeader.data.values?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Topshiriqlar!A1",
        valueInputOption: "RAW",
        requestBody: {
          values: [["ID", "Sarlavha", "Tavsif", "Ijrochi ID", "Ijrochi", "Topshirdi", "Muddat", "Holat", "Natija", "Boshlangan", "Bajarilgan", "Bo'lim", "Daraja", "Media turi"]],
        },
      });
    }

    // FIX: Davomat header check was using wrong range A1:F1 (6 cols) instead of A1:H1 (8 cols)
    const attendHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Davomat!A1:H1",
    });
    if (!attendHeader.data.values?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "Davomat!A1",
        valueInputOption: "RAW",
        requestBody: {
          values: [["Telegram ID", "Sana", "Kelish vaqti", "Joylashuv (koordinata)", "Manzil", "Ish joyidan masofa (m)", "Tashqarida", "Kech qoldi"]],
        },
      });
    }
    logger.info("Google Sheets boshlandi");
  } catch (err) {
    logger.error({ err }, "Google Sheets boshlashda xato");
  }
}

export async function loadUsersFromSheets(): Promise<User[]> {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Foydalanuvchilar!A:H",
    });
    const rows = res.data.values || [];
    const users: User[] = [];
    for (const row of rows.slice(1)) {
      if (!row[0] || row[0] === "Telegram ID") continue;
      const role = row[3] as User["role"];
      if (!["admin", "division_head", "employee"].includes(role)) continue;
      users.push({
        telegramId: String(row[0] || ""),
        username: String(row[1] || ""),
        fullName: String(row[2] || ""),
        role,
        divisionId: row[4] || undefined,
        isAllowed: row[5] === "Ha",
      });
    }
    logger.info({ count: users.length }, "Foydalanuvchilar Sheets dan yuklandi");
    return users;
  } catch (err) {
    logger.error({ err }, "Foydalanuvchilarni yuklashda xato");
    return [];
  }
}

export async function loadTasksFromSheets(): Promise<Task[]> {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Topshiriqlar!A:N",
    });
    const rows = res.data.values || [];
    const tasks: Task[] = [];
    for (const row of rows.slice(1)) {
      if (!row[0] || row[0] === "ID") continue;
      const statusRaw = String(row[7] || "");
      const status: Task["status"] =
        statusRaw === "Bajarildi" ? "completed" :
        statusRaw === "Bajarilmoqda" ? "in_progress" : "pending";
      const deadline = parseSheetDate(String(row[6] || ""));
      const createdAt = parseSheetDate(String(row[9] || ""));
      const completedAt = row[10] ? parseSheetDate(String(row[10])) : undefined;
      if (!deadline || !createdAt) continue;
      const levelRaw = String(row[12] || "");
      const level: Task["level"] = levelRaw.includes("Admin") ? "admin_to_head" : "head_to_employee";
      tasks.push({
        id: String(row[0]),
        title: String(row[1] || ""),
        description: String(row[2] || ""),
        assignedTo: String(row[3] || ""),
        assignedBy: "",
        deadline,
        status,
        result: row[8] || undefined,
        createdAt,
        completedAt,
        divisionId: row[11] || undefined,
        level,
        mediaType: (row[13] as MediaType) || undefined,
      });
    }
    logger.info({ count: tasks.length }, "Topshiriqlar Sheets dan yuklandi");
    return tasks;
  } catch (err) {
    logger.error({ err }, "Topshiriqlarni yuklashda xato");
    return [];
  }
}

function parseSheetDate(str: string): Date | undefined {
  if (!str) return undefined;
  try {
    const cleaned = str.replace(",", "").trim();
    const parts = cleaned.split(/\s+/);
    if (parts.length < 2) return undefined;
    const [datePart, timePart] = parts;
    const [day, month, year] = datePart.split(".").map(Number);
    const [hours, minutes] = timePart.split(":").map(Number);
    if (!day || !month || !year) return undefined;
    const d = new Date(year, month - 1, day, hours || 0, minutes || 0);
    return isNaN(d.getTime()) ? undefined : d;
  } catch {
    return undefined;
  }
}

export async function saveUser(user: User): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Foydalanuvchilar!A:A",
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((r) => r[0] === user.telegramId);

    const rowData = [
      user.telegramId,
      user.username,
      user.fullName,
      user.role,
      user.divisionId || "",
      user.isAllowed ? "Ha" : "Yo'q",
      new Date().toLocaleString("uz-UZ"),
      "",
    ];

    if (rowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Foydalanuvchilar!A${rowIndex + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [rowData] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "Foydalanuvchilar!A:H",
        valueInputOption: "RAW",
        requestBody: { values: [rowData] },
      });
    }
  } catch (err) {
    logger.error({ err }, "Foydalanuvchi saqlashda xato");
  }
}

export async function saveTask(task: Task, assigneeName: string, assignerName: string): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Topshiriqlar!A:A",
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((r) => r[0] === task.id);

    const rowData = [
      task.id,
      task.title,
      task.description,
      task.assignedTo,
      assigneeName,
      assignerName,
      task.deadline.toLocaleString("uz-UZ"),
      task.status === "pending" ? "Kutilmoqda" : task.status === "in_progress" ? "Bajarilmoqda" : "Bajarildi",
      task.result || "",
      task.createdAt.toLocaleString("uz-UZ"),
      task.completedAt?.toLocaleString("uz-UZ") || "",
      task.divisionId || "",
      task.level === "admin_to_head" ? "Admin → Bo'lim rahbari" : "Bo'lim rahbari → Xodim",
      task.mediaType || "",
    ];

    if (rowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        // FIX: was A:M (13 cols) but rowData has 14 elements; mediaType was being lost
        range: `Topshiriqlar!A${rowIndex + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [rowData] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        // FIX: was "Topshiriqlar!A:M" (13 cols) — now A:N to include mediaType column
        range: "Topshiriqlar!A:N",
        valueInputOption: "RAW",
        requestBody: { values: [rowData] },
      });
    }
  } catch (err) {
    logger.error({ err }, "Topshiriq saqlashda xato");
  }
}

export async function saveAttendance(attendance: Attendance): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    const coordStr = attendance.latitude
      ? `${attendance.latitude},${attendance.longitude}`
      : "Yuborilmadi";

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Davomat!A:H",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          attendance.telegramId,
          attendance.date,
          attendance.checkInTime,
          coordStr,
          attendance.address || "",
          attendance.distanceFromWork !== undefined ? attendance.distanceFromWork : "",
          attendance.isOutside ? "Ha" : "Yo'q",
          attendance.isLate ? "Ha" : "Yo'q",
        ]],
      },
    });
  } catch (err) {
    logger.error({ err }, "Davomat saqlashda xato");
  }
}
