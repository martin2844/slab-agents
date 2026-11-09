import type { Metadata } from "next";
import { WhatsAppHub } from "@/components/whatsapp-hub";
import { getWhatsAppHubData } from "@/lib/whatsapp-hub";

export const metadata: Metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

export default async function WhatsAppPage({
  searchParams,
}: PageProps<"/whatsapp">) {
  const { chat } = await searchParams;
  return (
    <WhatsAppHub
      initialData={await getWhatsAppHubData()}
      initialChatId={typeof chat === "string" ? chat : null}
    />
  );
}
