const TZ = "Asia/Tashkent";

export function nowUz(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

export function todayStrUz(): string {
  return new Date().toLocaleDateString("uz-UZ", { timeZone: TZ });
}

export function formatTimeUz(date: Date): string {
  return date.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function formatDateUz(date: Date): string {
  return date.toLocaleDateString("uz-UZ", { timeZone: TZ });
}

export function formatDateTimeUz(date: Date): string {
  return date.toLocaleString("uz-UZ", { timeZone: TZ });
}
