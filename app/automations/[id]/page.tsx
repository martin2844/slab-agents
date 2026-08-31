import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutomationEditor } from "@/components/automation-editor";
import { getAutomationsPageData } from "@/lib/page-data";
import { automationRepository } from "@/lib/repositories/automation-repository";

export const metadata: Metadata = { title: "Edit automation" };
export const dynamic = "force-dynamic";

export default async function EditAutomationPage(
  props: PageProps<"/automations/[id]">,
) {
  const { id } = await props.params;
  const automation = automationRepository.getAutomation(id);
  if (!automation) notFound();
  return (
    <AutomationEditor
      automation={automation}
      template={null}
      data={await getAutomationsPageData()}
    />
  );
}
