import { z } from "zod";

export const repositorySchema = z.object({
  sourceAppId: z.string().min(1),
  owner: z.string().min(1).max(39),
  name: z.string().min(1).max(100),
  defaultBranch: z.string().min(1).max(250),
  setupCommand: z.string().max(2000).nullable().default(null),
  testCommand: z.string().max(2000).nullable().default(null),
  lintCommand: z.string().max(2000).nullable().default(null),
  typecheckCommand: z.string().max(2000).nullable().default(null),
  setupNotes: z.string().max(20000).default(""),
  workProjectKey: z.string().max(20).nullable().default(null),
  enabled: z.boolean().default(true),
});
