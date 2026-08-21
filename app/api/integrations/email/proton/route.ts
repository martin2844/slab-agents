import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  connectManagedProtonBridge,
  getEmailIntegrationState,
} from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  emailAddress: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(4096).refine((value) => !/[\r\n]/.test(value)),
});

export async function GET() {
  return Response.json({ data: (await getEmailIntegrationState()).protonBridge });
}

export async function POST(request: Request) {
  try {
    return Response.json({
      data: await connectManagedProtonBridge(schema.parse(await request.json())),
    });
  } catch (error) {
    return apiError(error);
  }
}
