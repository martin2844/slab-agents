export type OperatorPackAcceptanceRubric = {
  requiresWorkRead: boolean;
  requiresDocsRead: boolean;
  requiresWorkWrite: boolean;
  expectedIssueStatus: string;
  maxCreatedWorkItems: number;
};

export type OperatorPackAcceptanceToolEvidence = {
  name: string;
  success: boolean;
  arguments: unknown;
  response: unknown;
};

export async function findAcceptanceAssignmentRun<T>(input: {
  tick: () => Promise<void>;
  find: () => T | undefined;
}) {
  await input.tick();
  let run = input.find();
  if (run) return run;
  await input.tick();
  run = input.find();
  return run;
}

function matchingSuccessfulTool(
  tools: OperatorPackAcceptanceToolEvidence[],
  pattern: RegExp,
  references: string[],
) {
  const normalizedReferences = references
    .map((reference) => reference.trim().toLocaleLowerCase())
    .filter(Boolean);
  return tools.some((tool) => {
    if (!tool.success || !pattern.test(tool.name)) return false;
    const evidence = JSON.stringify([
      tool.arguments,
      tool.response,
    ]).toLocaleLowerCase();
    return normalizedReferences.some((reference) =>
      evidence.includes(reference),
    );
  });
}

export function evaluateOperatorPackAcceptance(input: {
  rubric: OperatorPackAcceptanceRubric;
  tools: OperatorPackAcceptanceToolEvidence[];
  issueKey: string;
  docReferences: string[];
  issueStatus: string | null;
  commentCount: number;
}) {
  const createdWorkItems = input.tools.filter(
    (tool) => tool.success && /work\.create_issue$/.test(tool.name),
  ).length;
  const checks = {
    runCompleted: true,
    workRead:
      !input.rubric.requiresWorkRead ||
      matchingSuccessfulTool(
        input.tools,
        /work\.(get_issue|list_issues|search_issues)$/,
        [input.issueKey],
      ),
    docsRead:
      !input.rubric.requiresDocsRead ||
      matchingSuccessfulTool(
        input.tools,
        /docs\.(get_doc|search_docs)$/,
        input.docReferences,
      ),
    workWrite:
      !input.rubric.requiresWorkWrite ||
      matchingSuccessfulTool(input.tools, /work\.(add_comment|update_issue)$/, [
        input.issueKey,
      ]),
    durableComment: input.commentCount > 0,
    expectedStatus: input.issueStatus === input.rubric.expectedIssueStatus,
    boundedWorkCreation: createdWorkItems <= input.rubric.maxCreatedWorkItems,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    createdWorkItems,
  };
}
