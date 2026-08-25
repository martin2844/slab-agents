export type Row = Record<string, unknown>;

export const bool = (value: unknown) => Boolean(value);

export function json<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch (error) {
    throw new Error("Stored JSON is corrupt.", { cause: error });
  }
}

export function telemetryJson<T>(value: unknown, fallback: T): T {
  try {
    return json(value, fallback);
  } catch (error) {
    console.error("[repository] corrupt telemetry JSON", error);
    return fallback;
  }
}
