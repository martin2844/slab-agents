import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodingRunDetailView } from "@/components/coding/coding-run-detail";
import { getCodingRunDetail } from "@/lib/coding/service";

export const metadata: Metadata = { title: "Coding run" };
export const dynamic = "force-dynamic";

export default async function CodingRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const [{ id }, { stage }] = await Promise.all([params, searchParams]);
  const data = getCodingRunDetail(id);
  if (!data) notFound();
  return <CodingRunDetailView initialData={data} initialStage={stage === "chat" ? "chat" : null} />;
}
