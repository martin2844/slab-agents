import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(target)
        : /\.(?:ts|tsx)$/.test(entry.name)
          ? [target]
          : [];
    }),
  );
  return files.flat();
}

test("SQLite access stays inside database and repository modules", async () => {
  const files = [
    ...(await sourceFiles("app")),
    ...(await sourceFiles("components")),
    ...(await sourceFiles("lib")),
  ];
  const allowed = (file) =>
    file.startsWith(path.join("lib", "repositories")) ||
    file.startsWith(path.join("lib", "db"));
  const violations = [];

  for (const file of files.filter((candidate) => !allowed(candidate))) {
    const source = await readFile(file, "utf8");
    if (
      source.includes("@/lib/db/database") ||
      /\bdb\.(?:prepare|transaction|exec|pragma)\b/.test(source)
    ) {
      violations.push(file);
    }
  }

  assert.deepEqual(violations, []);
});

test("the legacy god repository and store naming cannot return", async () => {
  await assert.rejects(access("lib/repository.ts"));
  await assert.rejects(access("lib/repositories/mappers.ts"));
  const repositoryFiles = await readdir("lib/repositories");
  assert.deepEqual(
    repositoryFiles.filter((file) => file.endsWith("-store.ts")),
    [],
  );
  assert.ok(repositoryFiles.includes("run-repository.ts"));
  assert.ok(repositoryFiles.includes("integration-repository.ts"));
  assert.ok(repositoryFiles.includes("auth-repository.ts"));
  assert.ok(repositoryFiles.includes("budget-repository.ts"));
});

test("static prepared statements are not duplicated across repositories", async () => {
  const repositoryFiles = (await sourceFiles("lib/repositories")).filter(
    (file) => file.endsWith(".ts"),
  );
  const locations = new Map();

  for (const file of repositoryFiles) {
    const source = await readFile(file, "utf8");
    const statements = source.matchAll(
      /\.prepare\(\s*([`"'])([\s\S]*?)\1\s*\)/g,
    );
    for (const statement of statements) {
      const sql = statement[2].replace(/\s+/g, " ").trim();
      if (!sql || sql.includes("${")) continue;
      const duplicates = locations.get(sql) ?? [];
      duplicates.push(file);
      locations.set(sql, duplicates);
    }
  }

  const duplicates = [...locations.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([sql, files]) => ({ sql, files }));
  assert.deepEqual(duplicates, []);
});

test("repository objects do not depend on JavaScript method binding", async () => {
  const files = (await sourceFiles("lib/repositories")).filter(
    (file) =>
      file.endsWith("-repository.ts") &&
      !file.endsWith("run-queue-repository.ts"),
  );
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\bthis\./.test(source)) violations.push(file);
  }
  assert.deepEqual(violations, []);
});
