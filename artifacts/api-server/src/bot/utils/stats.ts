import * as store from "./store";
import { DIVISIONS } from "../config";
import type { Task } from "../types";

export interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  completionRate: number;
}

export function calcTaskStats(tasks: Task[]): TaskStats {
  const now = Date.now();
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const overdue = tasks.filter(
    (t) => t.status !== "completed" && t.deadline.getTime() < now
  ).length;
  const pending = total - completed;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pending, overdue, completionRate };
}

export function formatTaskStats(stats: TaskStats, label: string): string {
  const bar = buildProgressBar(stats.completionRate);
  return (
    `📊 *${label}*\n\n` +
    `${bar} ${stats.completionRate}%\n\n` +
    `📋 Jami topshiriqlar: *${stats.total}*\n` +
    `✅ Bajarilgan: *${stats.completed}*\n` +
    `⏳ Bajarilmagan: *${stats.pending}*\n` +
    `🚨 Muddati o'tgan: *${stats.overdue}*`
  );
}

function buildProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return "🟩".repeat(filled) + "⬜".repeat(empty);
}

export function formatTaskLine(task: Task): string {
  const now = Date.now();
  const isOverdue = task.status !== "completed" && task.deadline.getTime() < now;
  const statusIcon =
    task.status === "completed" ? "✅" : isOverdue ? "🚨" : "⏳";
  const remaining =
    task.status !== "completed"
      ? isOverdue
        ? "Muddati o'tdi!"
        : `${Math.round((task.deadline.getTime() - now) / 60000)} daqiqa qoldi`
      : "Bajarildi";
  return `${statusIcon} *${task.title}*\n   ⏰ ${task.deadline.toLocaleString("uz-UZ")} — ${remaining}`;
}

export function getAdminDivisionStats(): string {
  const heads = store.getDivisionHeads();
  const allTasks = store.getAllTasks();
  let text = "📊 *Bo'limlar bo'yicha statistika:*\n\n";

  for (const head of heads) {
    const divName = head.divisionId ? DIVISIONS[head.divisionId] || head.divisionId : "?";
    const employees = store.getUsersByDivision(head.divisionId || "");

    const headTasks = allTasks.filter((t) => t.assignedTo === head.telegramId);
    const empTasks = allTasks.filter(
      (t) => employees.some((e) => e.telegramId === t.assignedTo)
    );
    const divTasks = [...headTasks, ...empTasks];
    const stats = calcTaskStats(divTasks);

    const today = new Date().toLocaleDateString("uz-UZ");
    const presents = employees.filter((e) => {
      const att = store.getTodayAttendance(e.telegramId);
      return att !== undefined;
    }).length;
    const lates = employees.filter((e) => {
      const att = store.getTodayAttendance(e.telegramId);
      return att?.isLate === true;
    }).length;

    text += `🏢 *${divName}*\n`;
    text += `👤 Rahbar: ${head.fullName || head.username}\n`;
    text += `👥 Xodimlar: ${employees.length} | Keldi: ${presents} | Kech: ${lates}\n`;
    text += `📋 Topshiriqlar: ${stats.total} | ✅${stats.completed} | ⏳${stats.pending} | 🚨${stats.overdue}\n`;
    text += `📈 Bajarish: ${stats.completionRate}%\n\n`;
  }

  if (heads.length === 0) {
    text += "Hali bo'lim rahbarlari tayinlanmagan.";
  }
  return text;
}

export function getAdminDivisionTasks(divisionId: string): { text: string; tasks: Task[] } {
  const head = store.getDivisionHeads().find((h) => h.divisionId === divisionId);
  const employees = store.getUsersByDivision(divisionId);
  const allTasks = store.getAllTasks();

  const headTasks = head ? allTasks.filter((t) => t.assignedTo === head.telegramId) : [];
  const empTasks = allTasks.filter((t) =>
    employees.some((e) => e.telegramId === t.assignedTo)
  );
  const tasks = [...headTasks, ...empTasks];

  if (!tasks.length) {
    return { text: `📋 *${DIVISIONS[divisionId]}* — topshiriqlar yo'q.`, tasks: [] };
  }

  let text = `📋 *${DIVISIONS[divisionId] ?? divisionId} topshiriqlari:*\n\n`;

  if (headTasks.length) {
    text += `👔 *Rahbar topshiriqlari:*\n`;
    for (const t of headTasks) text += formatTaskLine(t) + "\n";
    text += "\n";
  }

  const byEmployee: Record<string, Task[]> = {};
  for (const emp of employees) {
    const empT = empTasks.filter((t) => t.assignedTo === emp.telegramId);
    if (empT.length) byEmployee[emp.telegramId] = empT;
  }

  if (Object.keys(byEmployee).length) {
    text += `👤 *Xodimlar topshiriqlari:*\n`;
    for (const [empId, empT] of Object.entries(byEmployee)) {
      const emp = store.getUser(empId);
      text += `\n_${emp?.fullName || emp?.username || empId}:_\n`;
      for (const t of empT) text += formatTaskLine(t) + "\n";
    }
  }

  return { text, tasks };
}

export function getHeadStats(headId: string): string {
  const head = store.getUser(headId);
  const divisionId = head?.divisionId || "";
  const divName = divisionId ? DIVISIONS[divisionId] || divisionId : "Bo'lim";
  const employees = store.getUsersByDivision(divisionId);
  const allTasks = store.getAllTasks();

  const headTasks = allTasks.filter((t) => t.assignedTo === headId);
  const headStats = calcTaskStats(headTasks);

  const empTasks = allTasks.filter((t) =>
    employees.some((e) => e.telegramId === t.assignedTo)
  );
  const empStats = calcTaskStats(empTasks);
  const allDivStats = calcTaskStats([...headTasks, ...empTasks]);

  const today = new Date().toLocaleDateString("uz-UZ");
  const presents = employees.filter((e) => store.getTodayAttendance(e.telegramId)).length;
  const lates = employees.filter((e) => store.getTodayAttendance(e.telegramId)?.isLate).length;
  const headAtt = store.getTodayAttendance(headId);

  let text = `📊 *${divName} statistikasi*\n\n`;

  text += `👔 *Mening statistikam:*\n`;
  text += `   Davomat: ${headAtt ? `✅ ${headAtt.checkInTime}${headAtt.isLate ? " ⚠️ Kech" : ""}` : "❌ Kelmagan"}\n`;
  text += `   📋 Topshiriqlar: ${headStats.total} | ✅${headStats.completed} | ⏳${headStats.pending}\n`;
  text += `   📈 Bajarish: ${headStats.completionRate}%\n\n`;

  text += `👥 *Xodimlar (${employees.length} kishi):*\n`;
  text += `   Keldi: ${presents} | Kech: ${lates} | Kelmagan: ${employees.length - presents}\n`;
  text += `   📋 Topshiriqlar: ${empStats.total} | ✅${empStats.completed} | ⏳${empStats.pending}\n`;
  text += `   📈 Bajarish: ${empStats.completionRate}%\n\n`;

  text += `🏢 *Umumiy (bo'lim):*\n`;
  text += `   📋 Jami: ${allDivStats.total} | ✅${allDivStats.completed} | 🚨${allDivStats.overdue}\n`;
  text += `   📈 Bajarish: ${allDivStats.completionRate}%`;

  return text;
}

export function getHeadAllTasks(headId: string): string {
  const head = store.getUser(headId);
  const divisionId = head?.divisionId || "";
  const divName = divisionId ? DIVISIONS[divisionId] || divisionId : "Bo'lim";
  const employees = store.getUsersByDivision(divisionId);
  const allTasks = store.getAllTasks();

  const headTasks = allTasks.filter((t) => t.assignedTo === headId);
  const empTasks = allTasks.filter((t) =>
    employees.some((e) => e.telegramId === t.assignedTo)
  );

  if (!headTasks.length && !empTasks.length) {
    return `📋 *${divName}* — hali topshiriqlar yo'q.`;
  }

  let text = `📋 *${divName} — barcha topshiriqlar:*\n\n`;

  if (headTasks.length) {
    text += `👔 *Mening topshiriqlarim:*\n`;
    for (const t of headTasks) text += formatTaskLine(t) + "\n";
    text += "\n";
  }

  if (empTasks.length) {
    text += `👤 *Xodimlar topshiriqlari:*\n`;
    for (const emp of employees) {
      const empT = empTasks.filter((t) => t.assignedTo === emp.telegramId);
      if (!empT.length) continue;
      text += `\n_${emp.fullName || emp.username}:_\n`;
      for (const t of empT) text += formatTaskLine(t) + "\n";
    }
  }

  return text;
}

export function getEmployeeStats(empId: string): string {
  const emp = store.getUser(empId);
  const name = emp?.fullName || emp?.username || empId;
  const tasks = store.getAllTasks().filter((t) => t.assignedTo === empId);
  const stats = calcTaskStats(tasks);

  const att = store.getTodayAttendance(empId);
  const today = new Date().toLocaleDateString("uz-UZ");

  let text = `📊 *${name} — statistika*\n\n`;
  text += `📅 *Bugungi davomat (${today}):*\n`;
  text += att
    ? `   ✅ Keldi: ${att.checkInTime}${att.isLate ? "\n   ⚠️ Kech qoldi" : "\n   🟢 O'z vaqtida"}\n`
    : `   ❌ Hali kelmagan\n`;
  text += `\n📋 *Topshiriqlar:*\n`;
  text += formatTaskStats(stats, "Mening topshiriqlarim").split("\n").slice(1).join("\n");

  return text;
}
