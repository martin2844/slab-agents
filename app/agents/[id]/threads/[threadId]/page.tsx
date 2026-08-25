import { runRepository } from "@/lib/repositories/run-repository";
import { ThreadChat } from "@/components/thread-chat";
import { getThreadPageData } from "@/lib/page-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
  searchParams,
}: PageProps<"/agents/[id]/threads/[threadId]">) {
  const { threadId } = await params;
  const { run } = await searchParams;
  const data = getThreadPageData(threadId);
  if (!data) notFound();
  const requestedRun =
    typeof run === "string" ? runRepository.getRun(run) : null;
  const linkedRun =
    requestedRun?.threadId === threadId
      ? requestedRun
      : runRepository.getActiveRunForThread(threadId);
  return (
    <ThreadChat
      key={threadId}
      threadId={threadId}
      initialData={data}
      initialRunId={linkedRun?.threadId === threadId ? linkedRun.id : null}
    />
  );
}
