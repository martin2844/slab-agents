import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodingRunDetailView } from "@/components/coding/coding-run-detail";
import { getCodingRunDetail } from "@/lib/coding/service";

export const metadata: Metadata = { title: "Coding run" };
export const dynamic = "force-dynamic";

export default async function CodingRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getCodingRunDetail(id);
  if (!data) notFound();
  return <CodingRunDetailView initialData={data} />;
}
