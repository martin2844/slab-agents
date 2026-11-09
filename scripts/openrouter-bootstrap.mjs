#!/usr/bin/env node

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  encryptLocalSecret,
  decryptLocalSecret,
} from "../lib/local-secrets.mjs";
import { discoverOpenRouterModels } from "../lib/openrouter-discovery.mjs";

export async function openRouterAvailable(database, fetcher = fetch) {
  const config = database
    .prepare("SELECT * FROM runtime_configs WHERE runtime_id = 'openrouter'")
    .get();
  if (
    !config?.enabled ||
    !config.credential_ciphertext ||
    config.last_verification_status !== "connected"
  )
    return false;
  decryptLocalSecret(config.credential_ciphertext);
  const storedUrl = database
    .prepare("SELECT value FROM settings WHERE key = 'runner_url'")
    .get()?.value;
  const token = process.env.RUNNER_TOKEN_FILE
    ? fs.readFileSync(process.env.RUNNER_TOKEN_FILE, "utf8").trim()
    : process.env.RUNNER_TOKEN;
  const response = await fetcher(
    `${(storedUrl || process.env.RUNNER_URL || "http://127.0.0.1:6990").replace(/\/+$/, "")}/runtimes`,
    {
      headers: token ? { "X-Runner-Token": token } : {},
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    },
  );
  if (!response.ok) return false;
  const payload = await response.json();
  return (
    Array.isArray(payload.data) &&
    payload.data.some(
      (runtime) =>
        // API credentials belong to Agents and are sent with each run. Runner's
        // unauthenticated catalog therefore reports authentication_required.
        runtime.id === "openrouter" &&
        ["available", "authentication_required"].includes(runtime.status),
    )
  );
}

export async function bootstrapOpenRouter(
  database,
  credential,
  model,
  fetcher = fetch,
) {
  const current = database
    .prepare("SELECT * FROM runtime_configs WHERE runtime_id = 'openrouter'")
    .get();
  if (!current) throw new Error("OpenRouter migrations have not been applied.");
  // Re-running the installer must preserve credentials and policy edited in Settings.
  if (current.credential_ciphertext) return false;
  if (
    !credential.trim() ||
    credential.length > 4096 ||
    /[\r\n]/.test(credential)
  ) {
    throw new Error("Read one OpenRouter API key from stdin.");
  }
  if (
    model.length > 200 ||
    !/^[A-Za-z0-9_.:-]+\/[A-Za-z0-9/_.:-]+$/.test(model)
  ) {
    throw new Error("Choose an explicit OpenRouter model ID (provider/model).");
  }
  const models = await discoverOpenRouterModels(credential.trim(), {
    fetcher,
    zdr: Boolean(current.openrouter_zdr),
  });
  if (!models.includes(model))
    throw new Error(
      "The selected model is not available with tool support and the configured privacy policy.",
    );
  const timestamp = new Date().toISOString();
  const result = database
    .prepare(
      `UPDATE runtime_configs SET
    enabled=1, credential_ciphertext=?, default_model=?, models_json=?,
    config_version=config_version+1, last_verification_status='connected',
    last_verification_detail=?, last_verified_at=?, updated_at=?
    WHERE runtime_id='openrouter' AND config_version=? AND credential_ciphertext IS NULL
  `,
    )
    .run(
      encryptLocalSecret(credential.trim()),
      model,
      JSON.stringify(models),
      `${models.length} tool-capable OpenRouter models available.`,
      timestamp,
      timestamp,
      current.config_version,
    );
  if (result.changes !== 1)
    throw new Error(
      "Runtime configuration changed during setup; existing settings were preserved.",
    );
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1)
    throw new Error(
      "Usage: openrouter-bootstrap.mjs MODEL < api-key.txt | --status",
    );
  const database = new Database(
    path.resolve(process.env.SLAB_WORKSPACE_DB || ".data/slab-workspace.db"),
    { fileMustExist: true },
  );
  database.pragma("busy_timeout = 5000");
  try {
    if (args[0] === "--status") {
      process.exitCode = (await openRouterAvailable(database)) ? 0 : 1;
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 4096) throw new Error("API key input is too large.");
      chunks.push(chunk);
    }
    const credential = Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/, "");
    const configured = await bootstrapOpenRouter(database, credential, args[0]);
    process.stdout.write(
      configured
        ? "OpenRouter API key and model verified; configuration saved.\n"
        : "Existing OpenRouter configuration preserved.\n",
    );
  } finally {
    database.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    // Never print provider responses or exceptions that might contain the credential.
    process.stderr.write(
      "OpenRouter setup failed. Check the API key, model, network, and release support. Configure and test OpenRouter in Settings > Runtime.\n",
    );
    process.exitCode = 1;
  });
}
