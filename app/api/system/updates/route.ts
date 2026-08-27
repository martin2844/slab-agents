import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getSystemUpdatesData,
  requestSystemUpdate,
  updateSystemUpdatePolicy,
} from "@/lib/system-update-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    action: z.enum(["check", "apply"]),
    channel: z.enum(["stable", "candidate"]),
    target: z.string().max(200).nullable().optional(),
  })
  .strict();

const policySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    enabled: z.boolean(),
    checkHourUtc: z.number().int().min(0).max(23),
  })
  .strict();

export async function GET() {
  try {
    return Response.json({ data: await getSystemUpdatesData() });
  } catch (error) {
    return apiError(error, "Could not read system update status");
  }
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    return Response.json(
      { data: await requestSystemUpdate(input) },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error, "Could not submit the system update request");
  }
}

export async function PATCH(request: Request) {
  try {
    return Response.json({
      data: updateSystemUpdatePolicy(policySchema.parse(await request.json())),
    });
  } catch (error) {
    return apiError(error, "Could not save the automatic update policy");
  }
}
