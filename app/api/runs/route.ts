import { getRunsActivityData, getRunsPageData } from "@/lib/page-data";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const activity = new URL(request.url).searchParams.get("activity") === "1";
  return Response.json({
    data: activity ? getRunsActivityData() : getRunsPageData(),
  });
}
