import { z } from "zod";
import { apiError } from "@/lib/api";
import { configureTelegram, disconnectTelegram, getTelegramStatus } from "@/lib/telegram/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: getTelegramStatus() });
}

/** Saves the bot token and returns a one-time code to link your chat. */
export async function POST(request: Request) {
  try {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await request.json());
    return Response.json({ data: await configureTelegram(token) });
  } catch (error) {
    return apiError(error, "Could not connect the Telegram bot.");
  }
}

export async function DELETE() {
  disconnectTelegram();
  return Response.json({ data: getTelegramStatus() });
}
