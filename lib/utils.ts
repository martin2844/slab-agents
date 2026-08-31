import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown time";

  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function formatDateTimeInTimeZone(
  value: string | number | Date,
  timeZone: string,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}

export function formatRelativePast(
  value: string | number | Date,
  currentTime = new Date(),
) {
  const targetTime = new Date(value).getTime();
  if (Number.isNaN(targetTime)) return "Unknown time";
  const elapsedMs = Math.max(
    0,
    currentTime.getTime() - targetTime,
  );
  if (elapsedMs < 60_000) return "just now";
  if (elapsedMs < 3_600_000) return `${Math.floor(elapsedMs / 60_000)}m ago`;
  if (elapsedMs < 86_400_000)
    return `${Math.floor(elapsedMs / 3_600_000)}h ago`;
  return `${Math.floor(elapsedMs / 86_400_000)}d ago`;
}

export function formatRelativeFuture(
  value: string | number | Date,
  currentTime = new Date(),
) {
  const targetTime = new Date(value).getTime();
  if (Number.isNaN(targetTime)) return "Unknown time";
  const remainingMs = targetTime - currentTime.getTime();
  if (remainingMs <= 60_000) return "within a minute";
  if (remainingMs < 3_600_000) return `in ${Math.ceil(remainingMs / 60_000)}m`;
  if (remainingMs < 86_400_000)
    return `in ${Math.ceil(remainingMs / 3_600_000)}h`;
  return `in ${Math.ceil(remainingMs / 86_400_000)}d`;
}
