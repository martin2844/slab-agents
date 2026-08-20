import "server-only";

import fs from "node:fs";

export function readSecret(
  environmentName: string,
  fileEnvironmentName: string,
) {
  const direct = process.env[environmentName]?.trim();
  if (direct) return direct;

  const filename = process.env[fileEnvironmentName]?.trim();
  if (!filename) return "";

  try {
    return fs.readFileSync(filename, "utf8").trim();
  } catch {
    throw new Error(
      `Unable to read the secret configured by ${fileEnvironmentName}.`,
    );
  }
}

export function controlPlaneInternalUrl() {
  const configured = process.env.CONTROL_PLANE_INTERNAL_URL?.trim();
  const fallback = `http://127.0.0.1:${process.env.PORT?.trim() || "3009"}`;
  const url = new URL(configured || fallback);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("CONTROL_PLANE_INTERNAL_URL must use http or https.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function internalRoute(pathname: string) {
  return `${controlPlaneInternalUrl()}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
