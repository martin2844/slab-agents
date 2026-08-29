export const GITHUB_DOCUMENT_EXTENSIONS = ["md", "mdx", "txt", "rst", "adoc"];

export const GITHUB_CODE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "cs",
  "php",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "css",
  "scss",
  "less",
  "html",
  "vue",
  "svelte",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "graphql",
  "gql",
  "proto",
  "tf",
  "hcl",
  "xml",
  "gradle",
  "properties",
  "mod",
];

export const GITHUB_CODE_FILENAMES = [
  "dockerfile",
  "makefile",
  "gemfile",
  "rakefile",
  "procfile",
];

export const DEFAULT_GITHUB_SOURCE_SELECTORS = [
  ...GITHUB_DOCUMENT_EXTENSIONS,
  ...GITHUB_CODE_EXTENSIONS,
  ...GITHUB_CODE_FILENAMES,
];

const DOCUMENT_EXTENSIONS = new Set(GITHUB_DOCUMENT_EXTENSIONS);
const CODE_FILENAMES = new Set(GITHUB_CODE_FILENAMES);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".venv",
  "__pycache__",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "obj",
  "target",
  "vendor",
  "venv",
]);
const EXCLUDED_FILENAMES = new Set([
  "bun.lock",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock",
]);
const SENSITIVE_FILENAMES = new Set([
  ".npmrc",
  ".pypirc",
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);
const SENSITIVE_SUFFIXES = [
  ".asc",
  ".gpg",
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx",
];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  adoc: "asciidoc",
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  fish: "fish",
  go: "go",
  gql: "graphql",
  gradle: "gradle",
  graphql: "graphql",
  h: "c",
  hcl: "hcl",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mod: "go-mod",
  php: "php",
  properties: "properties",
  proto: "protobuf",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  rst: "rst",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  tf: "terraform",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "zsh",
};

export type GitHubFileDescriptor = {
  kind: "document" | "code";
  language: string;
};

function basename(path: string) {
  return path.split("/").pop()?.toLowerCase() ?? "";
}

function extension(path: string) {
  const name = basename(path);
  const separator = name.lastIndexOf(".");
  return separator >= 0 ? name.slice(separator + 1) : "";
}

export function normalizeGitHubFileSelectors(values: string[]) {
  return new Set(
    values.map((value) => value.trim().replace(/^\./, "").toLowerCase()),
  );
}

export function githubFileDescriptor(
  path: string,
  selectors: ReadonlySet<string>,
): GitHubFileDescriptor | null {
  const segments = path.toLowerCase().split("/");
  const name = basename(path);
  const suffix = extension(path);

  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment)))
    return null;
  if (EXCLUDED_FILENAMES.has(name)) return null;
  if (
    SENSITIVE_FILENAMES.has(name) ||
    name === ".env" ||
    name.startsWith(".env.")
  ) {
    return null;
  }
  if (SENSITIVE_SUFFIXES.some((candidate) => name.endsWith(candidate)))
    return null;
  if (
    name.endsWith(".min.js") ||
    name.endsWith(".min.css") ||
    name.endsWith(".map")
  ) {
    return null;
  }

  const selected = selectors.has(suffix) || selectors.has(name);
  if (!selected) return null;
  const isDocument = DOCUMENT_EXTENSIONS.has(suffix);
  const language =
    LANGUAGE_BY_EXTENSION[suffix] ?? (CODE_FILENAMES.has(name) ? name : "text");
  return { kind: isDocument ? "document" : "code", language };
}

export function formatGitHubFileBody(
  body: string,
  descriptor: GitHubFileDescriptor,
) {
  if (descriptor.kind === "document") return body;
  const longestFence = Math.max(
    2,
    ...Array.from(body.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestFence + 1);
  return `${fence}${descriptor.language}\n${body}\n${fence}`;
}
