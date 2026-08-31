import type { Metadata } from "next";

import { AutomationEditor } from "@/components/automation-editor";
import { getAutomationTemplate } from "@/lib/automation-templates";
import { getAutomationsPageData } from "@/lib/page-data";

export const metadata: Metadata = { title: "Create automation" };
export const dynamic = "force-dynamic";

export default async function NewAutomationPage(
  props: PageProps<"/automations/new">,
) {
  const searchParams = await props.searchParams;
  const templateId =
    typeof searchParams.template === "string"
      ? searchParams.template
      : undefined;
  return (
    <AutomationEditor
      automation={null}
      template={getAutomationTemplate(templateId)}
      data={await getAutomationsPageData()}
    />
  );
}
