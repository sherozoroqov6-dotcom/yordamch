export interface User {
  telegramId: string;
  username: string;
  fullName: string;
  role: "admin" | "division_head" | "employee";
  divisionId?: string;
  isAllowed: boolean;
}

export interface Division {
  id: string;
  name: string;
  headTelegramId: string;
}

export type MediaType = "photo" | "video" | "voice" | "audio" | "document" | "video_note" | "sticker" | "animation";

export interface Task {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  deadline: Date;
  status: "pending" | "in_progress" | "completed";
  mediaFileId?: string;
  mediaType?: MediaType;
  result?: string;
  resultFileId?: string;
  resultMediaType?: MediaType;
  createdAt: Date;
  completedAt?: Date;
  divisionId?: string;
  level: "admin_to_head" | "head_to_employee";
}

export interface Attendance {
  telegramId: string;
  date: string;
  checkInTime: string;
  latitude?: number;
  longitude?: number;
  isLate: boolean;
  distanceFromWork?: number;
  address?: string;
  isOutside?: boolean;
}

export interface UserSession {
  state?: string;
  data?: Record<string, unknown>;
}
