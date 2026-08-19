import { apiError } from "@/lib/api";
import { testEmailAccount } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    return Response.json({ data: await testEmailAccount(accountId) });
  } catch (error) {
    return apiError(error);
  }
}
