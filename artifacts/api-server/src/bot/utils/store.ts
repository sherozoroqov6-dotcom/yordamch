import type { User, Task, Attendance, UserSession, Division } from "../types";
import { DIVISIONS } from "../config";
import { logger } from "../../lib/logger";

const users = new Map<string, User>();
const tasks = new Map<string, Task>();
const sessions = new Map<string, UserSession>();
const attendanceToday = new Map<string, Attendance>();

export function initDivisions(): Division[] {
  return Object.entries(DIVISIONS).map(([id, name]) => ({
    id,
    name,
    headTelegramId: "",
  }));
}

const divisions: Division[] = initDivisions();

export function getUser(telegramId: string): User | undefined {
  return users.get(telegramId);
}

export function getAllUsers(): User[] {
  return Array.from(users.values());
}

export function setUser(user: User): void {
  users.set(user.telegramId, user);
}

export function removeUser(telegramId: string): void {
  users.delete(telegramId);
}

export function getTask(taskId: string): Task | undefined {
  return tasks.get(taskId);
}

export function getAllTasks(): Task[] {
  return Array.from(tasks.values());
}

export function setTask(task: Task): void {
  tasks.set(task.id, task);
}

export function getSession(telegramId: string): UserSession {
  return sessions.get(telegramId) || {};
}

export function setSession(telegramId: string, session: UserSession): void {
  sessions.set(telegramId, session);
}

export function clearSession(telegramId: string): void {
  sessions.delete(telegramId);
}

export function getDivisions(): Division[] {
  return divisions;
}

export function getDivision(divisionId: string): Division | undefined {
  return divisions.find((d) => d.id === divisionId);
}

export function setDivisionHead(divisionId: string, telegramId: string): void {
  const div = divisions.find((d) => d.id === divisionId);
  if (div) {
    div.headTelegramId = telegramId;
    const user = users.get(telegramId);
    if (user) {
      user.role = "division_head";
      user.divisionId = divisionId;
      users.set(telegramId, user);
    }
    logger.info({ divisionId, telegramId }, "Bo'lim rahbari belgilandi");
  }
}

export function setDivisionHeadFromLoad(divisionId: string, telegramId: string): void {
  const div = divisions.find((d) => d.id === divisionId);
  if (div) {
    div.headTelegramId = telegramId;
  }
}

export function getUsersByDivision(divisionId: string): User[] {
  return Array.from(users.values()).filter(
    (u) => u.divisionId === divisionId && u.role === "employee"
  );
}

export function getDivisionHeads(): User[] {
  return Array.from(users.values()).filter((u) => u.role === "division_head");
}

export function getTodayAttendance(telegramId: string): Attendance | undefined {
  const today = new Date().toLocaleDateString("uz-UZ");
  const key = `${telegramId}_${today}`;
  return attendanceToday.get(key);
}

export function setTodayAttendance(attendance: Attendance): void {
  const key = `${attendance.telegramId}_${attendance.date}`;
  attendanceToday.set(key, attendance);
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
