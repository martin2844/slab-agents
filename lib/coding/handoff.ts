// Parses stage handoff files. Pure functions: no I/O.

export type HandoffFrontmatter = {
  values: Record<string, string>;
  questions: string[];
};

export type ParsedHandoff = {
  frontmatter: HandoffFrontmatter | null;
  body: string;
};

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function inlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    // Fall back to a simple comma split for unquoted YAML flow lists.
  }
  return inner
    .split(",")
    .map((item) => unquote(item))
    .filter(Boolean);
}

/** Minimal YAML frontmatter reader for the stage contract (scalars and `questions` lists). */
export function parseHandoff(source: string): ParsedHandoff {
  const text = source.replace(/^﻿/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: null, body: text.trim() };
  const values: Record<string, string> = {};
  const questions: string[] = [];
  let listKey: string | null = null;
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      if (listKey === "questions") questions.push(unquote(item[1]!));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1]!.toLowerCase();
    const value = pair[2] ?? "";
    if (!value.trim()) {
      listKey = key;
      continue;
    }
    listKey = null;
    const list = inlineList(value);
    if (list) {
      if (key === "questions") questions.push(...list);
      values[key] = list.join(", ");
      continue;
    }
    values[key] = unquote(value);
  }
  return {
    frontmatter: { values, questions: questions.filter(Boolean) },
    body: text.slice(match[0].length).trim(),
  };
}

export type StageOutcome =
  | { kind: "missing"; reason: string }
  | { kind: "needs_input"; questions: string[]; summary: string }
  | {
      kind: "done";
      summary: string;
      verdict: string | null;
      values: Record<string, string>;
    };

export function summarize(body: string, max = 200) {
  const line =
    body
      .split("\n")
      .map((value) => value.replace(/^#+\s*/, "").trim())
      .find((value) => value && !value.startsWith("|") && !value.startsWith("---")) ??
    "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Turns a handoff file into the outcome the orchestrator acts on. */
export function stageOutcome(content: string | null): StageOutcome {
  if (content === null || !content.trim()) {
    return {
      kind: "missing",
      reason: "The stage finished without writing its output file.",
    };
  }
  const parsed = parseHandoff(content);
  if (!parsed.frontmatter) {
    return {
      kind: "missing",
      reason:
        "The output file has no YAML frontmatter. Start the file with --- and a status field.",
    };
  }
  const status = parsed.frontmatter.values.status?.toLowerCase() ?? "";
  if (status === "needs_input") {
    return {
      kind: "needs_input",
      questions: parsed.frontmatter.questions,
      summary: summarize(parsed.body),
    };
  }
  if (status !== "done") {
    return {
      kind: "missing",
      reason: `The output frontmatter has status "${status || "(missing)"}". Use status: done or status: needs_input.`,
    };
  }
  const values = parsed.frontmatter.values;
  return {
    kind: "done",
    summary: summarize(parsed.body),
    verdict: values.verdict ?? values.ready ?? values.checks ?? null,
    values,
  };
}

/** Pulls the failed rubric rows and the required changes out of review.md. */
export function reviewFeedback(source: string) {
  const { body } = parseHandoff(source);
  const failedRows = body
    .split("\n")
    .filter((line) => /^\|/.test(line) && /\|\s*fail\s*\|/i.test(line));
  const required = /##\s*Required changes\s*\n([\s\S]*?)(\n##\s|$)/i.exec(body);
  const parts: string[] = [];
  if (failedRows.length) parts.push(`Failed rubric items:\n${failedRows.join("\n")}`);
  if (required?.[1]?.trim()) parts.push(`Required changes:\n${required[1].trim()}`);
  return parts.join("\n\n").slice(0, 6000);
}

/** Extracts a markdown section ("## Title") body. */
export function markdownSection(source: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`##\\s*${escaped}\\s*\\n([\\s\\S]*?)(\\n##\\s|$)`, "i").exec(
    parseHandoff(source).body,
  );
  return match?.[1]?.trim() ?? "";
}
