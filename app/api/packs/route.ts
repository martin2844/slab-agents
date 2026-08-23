import { apiError } from "@/lib/api";
import {
  getOperatorPackSummaries,
  importOperatorPack,
  operatorPackMetrics,
} from "@/lib/packs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({
      data: {
        packs: await getOperatorPackSummaries(),
        metrics: operatorPackMetrics(),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      { data: importOperatorPack(await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
