import { ThreadChat } from "@/components/thread-chat";
import { getThreadPageData } from "@/lib/page-data";
import { repository } from "@/lib/repository";
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
  const requestedRun = typeof run === "string" ? repository.getRun(run) : null;
  const linkedRun =
    requestedRun?.threadId === threadId
      ? requestedRun
      : repository.getActiveRunForThread(threadId);
  return (
    <ThreadChat
      key={threadId}
      threadId={threadId}
      initialData={data}
      initialRunId={linkedRun?.threadId === threadId ? linkedRun.id : null}
    />
  );
}
