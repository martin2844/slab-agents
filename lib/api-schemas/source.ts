import { z } from "zod";
import { DEFAULT_GITHUB_SOURCE_SELECTORS } from "../sources/github-files.ts";

const httpUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    !url.hash
  );
}, "URL must use HTTP or HTTPS and must not contain credentials or a fragment");

const sourceName = z.string().trim().min(1).max(120);
const sourceSecret = z.string().max(8_192).optional();
const syncInterval = z
  .number()
  .int()
  .min(15)
  .max(10_080)
  .nullable()
  .default(360);
const maxDocuments = z.number().int().min(1).max(500).default(200);
const pathPrefix = z.string().trim().max(240);

const common = {
  id: z.string().uuid().optional(),
  name: sourceName,
  enabled: z.boolean().default(true),
  syncIntervalMinutes: syncInterval,
  expectedVersion: z.number().int().positive().optional(),
  expectedAccessVersion: z.number().int().positive().optional(),
  agentIds: z.array(z.string().uuid()).max(100).optional(),
  secret: sourceSecret,
};

export const wordpressSourceInputSchema = z.object({
  ...common,
  kind: z.literal("wordpress"),
  siteUrl: httpUrl,
  authType: z.enum(["none", "basic", "bearer"]).default("none"),
  username: z.string().trim().max(160).nullable().default(null),
  contentTypes: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .max(60),
    )
    .min(1)
    .max(20)
    .default(["posts", "pages"]),
  publishedOnly: z.boolean().default(true),
  maxDocuments,
});

export const githubSourceInputSchema = z.object({
  ...common,
  kind: z.literal("github"),
  repository: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Use owner/repository"),
  branch: z.string().trim().min(1).max(240).default("main"),
  authType: z.enum(["none", "bearer", "github_app"]).default("none"),
  githubAppId: z.string().uuid().nullable().default(null),
  pathPrefixes: z.array(pathPrefix).max(40).default([]),
  extensions: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\.?[A-Za-z0-9_-]+$/)
        .max(20),
    )
    .min(1)
    .max(80)
    .default(DEFAULT_GITHUB_SOURCE_SELECTORS),
  maxDocuments,
});

export const websiteSourceInputSchema = z.object({
  ...common,
  kind: z.literal("website"),
  siteUrl: httpUrl,
  sitemapUrl: httpUrl.nullable().default(null),
  authType: z.enum(["none", "basic", "bearer"]).default("none"),
  username: z.string().trim().max(160).nullable().default(null),
  includePathPrefixes: z.array(pathPrefix).max(40).default([]),
  maxDocuments,
});

export const knowledgeSourceInputSchema = z.discriminatedUnion("kind", [
  wordpressSourceInputSchema,
  githubSourceInputSchema,
  websiteSourceInputSchema,
]);

export const sourceDeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
  archiveDocuments: z.boolean().default(true),
});

export const githubAppCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  organization: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+$/)
    .max(100)
    .nullable()
    .default(null),
});

export type KnowledgeSourceInput = z.infer<typeof knowledgeSourceInputSchema>;
