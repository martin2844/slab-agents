import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  deleteEmailAccount,
  updateEmailAccount,
} from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    imapHost: z.string().trim().min(1).max(500).optional(),
    imapPort: z.coerce.number().int().min(1).max(65_535).optional(),
    imapTlsMode: z.enum(["ssl", "starttls", "none"]).optional(),
    smtpHost: z.string().trim().min(1).max(500).optional(),
    smtpPort: z.coerce.number().int().min(1).max(65_535).optional(),
    smtpTlsMode: z.enum(["ssl", "starttls", "none"]).optional(),
    customCA: z.string().trim().min(1).max(100_000).optional(),
    customTls: z.boolean().optional(),
    smtpMessageIdDomain: z.string().trim().min(1).max(500).optional(),
    username: z.string().trim().min(1).max(500).optional(),
    password: z.string().min(1).max(16_384).optional(),
    apiKey: z.string().trim().min(1).max(4096).optional(),
    inboxId: z.string().trim().min(1).max(320).optional(),
    baseUrl: z.string().trim().url().optional(),
    inboundEnabled: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "Provide at least one account update.",
    },
  );

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    return Response.json({
      data: await updateEmailAccount(
        accountId,
        schema.parse(await request.json()),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    return Response.json({ data: await deleteEmailAccount(accountId) });
  } catch (error) {
    return apiError(error);
  }
}
