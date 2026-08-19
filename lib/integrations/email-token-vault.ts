import "server-only";

import fs from "node:fs";
import path from "node:path";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";

function vaultDirectory() {
  const database = process.env.SLAB_WORKSPACE_DB;
  const dataDirectory = database
    ? path.dirname(path.resolve(database))
    : path.join(process.cwd(), ".data");
  return path.join(dataDirectory, "email-connector-tokens");
}

function tokenPath(tokenId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(tokenId)) {
    throw new Error("Invalid connector token identifier.");
  }
  return path.join(vaultDirectory(), `${tokenId}.enc`);
}

export function storeEmailConnectorToken(tokenId: string, rawToken: string) {
  const directory = vaultDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenPath(tokenId), encryptLocalSecret(rawToken), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function readEmailConnectorToken(tokenId: string) {
  try {
    return decryptLocalSecret(fs.readFileSync(tokenPath(tokenId), "utf8"));
  } catch {
    throw new Error(
      "The scoped Email connector token is unavailable. Save the agent Email access again to rotate it.",
    );
  }
}

export function deleteEmailConnectorToken(tokenId: string) {
  try {
    fs.unlinkSync(tokenPath(tokenId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
