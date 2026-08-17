import { getOverviewPageData } from "@/lib/page-data";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ data: await getOverviewPageData() });
}
