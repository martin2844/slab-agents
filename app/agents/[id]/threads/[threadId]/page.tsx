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
  return (
    <ThreadChat
      key={threadId}
      threadId={threadId}
      initialData={data}
      initialRunId={typeof run === "string" ? run : null}
    />
  );
}
