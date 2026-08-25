import { z } from "zod";
import {
  extractHttpPathParameters,
  normalizeHttpIntegrationBaseUrl,
  normalizeHttpOperationKey,
  normalizeHttpOperationPath,
} from "./http-contract.ts";
import type {
  CustomHttpIntegrationDraft,
  IntegrationOperationParameter,
} from "@/lib/types";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32_768;
const DEFAULT_MAX_ITEMS = 50;
const MAX_OPERATIONS = 50;
const MAX_PARAMETERS_PER_OPERATION = 20;

const parameterSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    location: z.enum(["path", "query"]),
    type: z.enum(["string", "number", "integer", "boolean"]),
    required: z.boolean().default(false),
    description: z.string().trim().max(240).optional(),
  })
  .strict();

const operationSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(240).default(""),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    path: z.string().trim().startsWith("/").max(240),
    parameters: z
      .array(parameterSchema)
      .max(MAX_PARAMETERS_PER_OPERATION)
      .default([]),
    responsePath: z.string().trim().max(240).optional(),
    maxResponseBytes: z.number().int().min(1_024).max(1_048_576).optional(),
    maxItems: z.number().int().min(1).max(500).nullable().optional(),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("custom_http").default("custom_http"),
    name: z.string().trim().min(1).max(160),
    baseUrl: z.string().url(),
    authentication: z
      .object({
        type: z.enum(["none", "bearer", "api_key_header"]),
        headerName: z.string().trim().max(80).optional(),
      })
      .strict()
      .default({ type: "none" }),
    defaults: z
      .object({
        timeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(120_000)
          .default(DEFAULT_TIMEOUT_MS),
        responsePath: z.string().trim().max(240).optional(),
        maxResponseBytes: z
          .number()
          .int()
          .min(1_024)
          .max(1_048_576)
          .default(DEFAULT_MAX_RESPONSE_BYTES),
        maxItems: z
          .number()
          .int()
          .min(1)
          .max(500)
          .nullable()
          .default(DEFAULT_MAX_ITEMS),
      })
      .strict()
      .default({
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
        maxItems: DEFAULT_MAX_ITEMS,
      }),
    operations: z.array(operationSchema).min(1).max(MAX_OPERATIONS),
  })
  .strict();

function importedText(value: string) {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)([^\s"'`,;]+)/gi, "$1[redacted]")
    .replace(
      /((?:password|token|secret|api[-_ ]?key)\s*(?::|=|\bis\b)\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[redacted]",
    )
    .replace(
      /\b(?:sk|pk)-(?:live|test)-[a-z0-9_-]{6,}\b|\bgh[pousr]_[a-z0-9]{12,}\b|\bxox[baprs]-[a-z0-9-]{10,}\b/gi,
      "[redacted]",
    )
    .replace(/\b[A-Z0-9_-]*SECRET[A-Z0-9_-]*\b/g, "[redacted]");
}

export function redactCustomHttpDocumentation(value: string) {
  return importedText(value);
}

function validateOperationContracts(
  operations: Array<{
    key: string;
    path: string;
    parameters: IntegrationOperationParameter[];
  }>,
) {
  const operationKeys = new Set<string>();
  for (const operation of operations) {
    const key = normalizeHttpOperationKey(operation.key);
    if (!key) throw new Error("Each operation needs a valid key.");
    if (operationKeys.has(key)) {
      throw new Error(`Operation key duplicated after normalization: ${key}`);
    }
    operationKeys.add(key);
    normalizeHttpOperationPath(operation.path);

    if (operation.parameters.length > MAX_PARAMETERS_PER_OPERATION) {
      throw new Error(
        `Operation '${key}' has more than ${MAX_PARAMETERS_PER_OPERATION} parameters.`,
      );
    }
    const parameters = new Map<string, IntegrationOperationParameter>();
    for (const parameter of operation.parameters) {
      const normalized = parameter.name.toLowerCase();
      if (parameters.has(normalized)) {
        throw new Error(
          `Operation '${key}' declares parameter '${parameter.name}' more than once.`,
        );
      }
      parameters.set(normalized, parameter);
    }
    const placeholders = extractHttpPathParameters(operation.path);
    for (const placeholder of placeholders) {
      const parameter = parameters.get(placeholder.toLowerCase());
      if (
        !parameter ||
        parameter.location !== "path" ||
        parameter.required !== true
      ) {
        throw new Error(
          `Path parameter '${placeholder}' must be declared as a required path parameter.`,
        );
      }
    }
    for (const parameter of operation.parameters) {
      if (
        parameter.location === "path" &&
        !placeholders.some(
          (placeholder) =>
            placeholder.toLowerCase() === parameter.name.toLowerCase(),
        )
      ) {
        throw new Error(
          `Path parameter '${parameter.name}' is not used in '${operation.path}'.`,
        );
      }
    }
  }
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toolKeyForPath(path: string, seen: Set<string>) {
  const segments = path
    .split("/")
    .filter(Boolean)
    .filter((segment) => !["api", "admin"].includes(segment))
    .map((segment) => segment.replace(/[{}]/g, ""));
  let base = `get_${segments.join("_") || "data"}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let suffix = 2;
  while (seen.has(`${base}_${suffix}`)) suffix += 1;
  base = `${base}_${suffix}`;
  seen.add(base);
  return base;
}

function stripMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstDescription(block: string) {
  const cleaned = block
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map(stripMarkdown)
    .find((part) => part && !part.startsWith("|"));
  return importedText(cleaned ?? "Read data from this endpoint.").slice(0, 240);
}

function inferCommonParameters(markdown: string) {
  const section = markdown.match(
    /##\s+Common query parameters([\s\S]*?)(?=\n##\s|$)/i,
  )?.[1];
  if (!section) return [];
  const parameters: IntegrationOperationParameter[] = [];
  const seen = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(stripMarkdown);
    if (cells.length < 3 || cells[0]?.toLowerCase() === "parameter") continue;
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    const name = cells[0]?.trim();
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) continue;
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) continue;
    if (parameters.length >= MAX_PARAMETERS_PER_OPERATION) {
      throw new Error(
        `Common query parameters are limited to ${MAX_PARAMETERS_PER_OPERATION}.`,
      );
    }
    seen.add(normalized);
    parameters.push({
      name,
      location: "query",
      type:
        name === "pii"
          ? "boolean"
          : name === "page" || name === "limit"
            ? "integer"
            : "string",
      required: false,
      description: importedText(
        `Default: ${cells[1] || "unspecified"}. ${cells[2] || ""}`.trim(),
      ),
    });
  }
  return parameters;
}

function inferBaseUrl(markdown: string) {
  const candidates = markdown.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
  for (const candidate of candidates) {
    try {
      return new URL(candidate.replace(/[.,;]+$/, "")).origin;
    } catch {
      // Continue to the next documented URL.
    }
  }
  return "";
}

function inferName(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1];
  return title ? stripMarkdown(title).slice(0, 160) : "Imported API";
}

function inferAuth(markdown: string) {
  if (/Authorization:\s*Bearer\s*</i.test(markdown)) {
    return { authType: "bearer" as const, authHeaderName: undefined };
  }
  const header = markdown.match(/^([A-Z][A-Za-z0-9-]+):\s*<[^>]+>/m)?.[1];
  return header
    ? { authType: "api_key_header" as const, authHeaderName: header }
    : { authType: "none" as const, authHeaderName: undefined };
}

function inferMarkdownDraft(markdown: string): CustomHttpIntegrationDraft {
  const endpointPattern = /^###\s+`?(GET|HEAD)\s+([^\s`]+)`?\s*$/gim;
  const matches = [...markdown.matchAll(endpointPattern)];
  if (!matches.length) {
    throw new Error(
      "No operations found. Document endpoints as headings such as `### GET /api/customers`.",
    );
  }
  if (matches.length > MAX_OPERATIONS) {
    throw new Error(
      `Documentation import supports at most ${MAX_OPERATIONS} operations.`,
    );
  }

  const commonParameters = inferCommonParameters(markdown);
  const responsePath = /"success"\s*:\s*true[\s\S]{0,120}"data"\s*:/i.test(
    markdown,
  )
    ? "data"
    : undefined;
  const seen = new Set<string>();
  const operations = matches.map((match, index) => {
    const method = match[1]!.toUpperCase() as "GET" | "HEAD";
    const path = match[2]!.split("?")[0]!;
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd);
    const parameters = commonParameters.map((parameter) => ({ ...parameter }));
    for (const placeholder of path.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)) {
      const name = placeholder[1]!;
      if (!parameters.some((parameter) => parameter.name === name)) {
        if (parameters.length >= MAX_PARAMETERS_PER_OPERATION) {
          throw new Error(
            `Operation '${path}' exceeds ${MAX_PARAMETERS_PER_OPERATION} parameters.`,
          );
        }
        parameters.push({
          name,
          location: "path",
          type: "string",
          required: true,
          description: `Path parameter ${name}.`,
        });
      }
    }
    if (
      /\binclude\s*=/i.test(body) &&
      !parameters.some(({ name }) => name === "include")
    ) {
      if (parameters.length >= MAX_PARAMETERS_PER_OPERATION) {
        throw new Error(
          `Operation '${path}' exceeds ${MAX_PARAMETERS_PER_OPERATION} parameters.`,
        );
      }
      parameters.push({
        name: "include",
        location: "query",
        type: "string",
        required: false,
        description: "Comma-separated response sections to include.",
      });
    }
    const key = toolKeyForPath(path, seen);
    return {
      key,
      name: humanize(key.replace(/^get_/, "Get ")),
      description: firstDescription(body),
      method,
      path,
      parameters,
      responsePath,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      maxItems: parameters.some(({ name }) => name === "limit")
        ? DEFAULT_MAX_ITEMS
        : null,
    };
  });
  validateOperationContracts(operations);
  const baseUrl = inferBaseUrl(markdown);
  const auth = inferAuth(markdown);
  const warnings = [
    "Review every generated operation and parameter before saving.",
    ...(commonParameters.some(({ name }) => name === "pii")
      ? [
          "A pii parameter was detected. Use a non-PII reader credential unless this agent explicitly requires personal data access.",
        ]
      : []),
    ...(baseUrl
      ? []
      : ["No absolute example URL was found; enter the base URL manually."]),
  ];
  return {
    schemaVersion: 1,
    name: inferName(markdown),
    baseUrl,
    ...auth,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    operations,
    sourceFormat: "markdown",
    warnings,
  };
}

function inferManifestDraft(source: string): CustomHttpIntegrationDraft {
  const parsed = manifestSchema.parse(JSON.parse(source));
  const baseUrl = normalizeHttpIntegrationBaseUrl(parsed.baseUrl);
  if (
    parsed.authentication.type === "api_key_header" &&
    !parsed.authentication.headerName?.trim()
  ) {
    throw new Error("API-key authentication requires an explicit headerName.");
  }
  const operations = parsed.operations.map((operation) => {
    const key = importedText(operation.key);
    if (key !== operation.key) {
      throw new Error(
        "Credential-shaped content is not allowed in operation keys.",
      );
    }
    return {
      ...operation,
      key,
      name: importedText(operation.name),
      description: importedText(operation.description),
      parameters: operation.parameters.map((parameter) => {
        const name = importedText(parameter.name);
        if (name !== parameter.name) {
          throw new Error(
            "Credential-shaped content is not allowed in parameter names.",
          );
        }
        return {
          ...parameter,
          name,
          description: parameter.description
            ? importedText(parameter.description)
            : undefined,
        };
      }),
      responsePath: operation.responsePath ?? parsed.defaults.responsePath,
      maxResponseBytes:
        operation.maxResponseBytes ?? parsed.defaults.maxResponseBytes,
      maxItems: operation.maxItems ?? parsed.defaults.maxItems,
    };
  });
  validateOperationContracts(operations);
  return {
    schemaVersion: 1,
    name: importedText(parsed.name),
    baseUrl,
    authType: parsed.authentication.type,
    authHeaderName: parsed.authentication.headerName,
    timeoutMs: parsed.defaults.timeoutMs,
    operations,
    sourceFormat: "manifest_json",
    warnings: [
      "Secrets are intentionally excluded from integration manifests.",
    ],
  };
}

export function buildCustomHttpIntegrationDraft(
  source: string,
): CustomHttpIntegrationDraft {
  const value = source.trim();
  if (!value) throw new Error("Paste API documentation or a manifest first.");
  if (value.startsWith("{")) return inferManifestDraft(value);
  return inferMarkdownDraft(value);
}

export const CUSTOM_HTTP_MANIFEST_EXAMPLE = {
  schemaVersion: 1,
  kind: "custom_http",
  name: "Clasificar Metrics",
  baseUrl: "https://clasific.ar",
  authentication: { type: "bearer" },
  defaults: {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    responsePath: "data",
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    maxItems: DEFAULT_MAX_ITEMS,
  },
  operations: [
    {
      key: "get_metrics",
      name: "Get metrics",
      description:
        "Return a curated business and operational metrics snapshot.",
      method: "GET",
      path: "/api/admin/metrics",
      parameters: [
        {
          name: "from",
          location: "query",
          type: "string",
          required: false,
          description: "ISO timestamp or YYYY-MM-DD.",
        },
      ],
    },
  ],
} as const;
