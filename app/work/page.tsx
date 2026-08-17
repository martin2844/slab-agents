import type { Metadata } from "next";
import { WorkBoard } from "@/components/work-board";
import { getWorkPageData } from "@/lib/page-data";
export const metadata: Metadata = { title: "Work" };
export const dynamic = "force-dynamic";
export default async function WorkPage() {
  return <WorkBoard initialData={await getWorkPageData()} />;
}
