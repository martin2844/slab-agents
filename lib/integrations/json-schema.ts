import { z } from "zod";

export function compileMcpInputSchema(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Unsupported remote MCP input schema: expected an object.");
  }
  try {
    return z.fromJSONSchema(raw as Parameters<typeof z.fromJSONSchema>[0]);
  } catch (error) {
    throw new Error(
      `Unsupported remote MCP input schema: ${error instanceof Error ? error.message : "invalid JSON Schema"}`,
    );
  }
}
