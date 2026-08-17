import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const keyPath = () => {
  const database = process.env.SLAB_WORKSPACE_DB;
  const directory = database
    ? path.dirname(path.resolve(database))
    : path.join(process.cwd(), ".data");
  return path.join(directory, "control-plane.key");
};

function loadKey() {
  const filename = keyPath();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    return Buffer.from(fs.readFileSync(filename, "utf8").trim(), "base64url");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  try {
    fs.writeFileSync(filename, key.toString("base64url"), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return Buffer.from(fs.readFileSync(filename, "utf8").trim(), "base64url");
  }
}

export function encryptLocalSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, ciphertext]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

export function decryptLocalSecret(value: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Stored integration credentials are invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    loadKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
