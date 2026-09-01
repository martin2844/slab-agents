function parsePublicOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SLAB_PUBLIC_URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("SLAB_PUBLIC_URL must not include credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SLAB_PUBLIC_URL must be an origin without a path");
  }
  return url.origin;
}

export function configuredPublicOrigin(
  configuredPublicUrl = process.env.SLAB_PUBLIC_URL ?? "",
) {
  const configured = configuredPublicUrl.trim();
  return configured ? parsePublicOrigin(configured) : "";
}

export function forwardedRequestOrigin(headers: Pick<Headers, "get">) {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim();
  if (!host) return "";

  const forwardedProtocol = headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProtocol || "http";
  if (protocol !== "http" && protocol !== "https") return "";

  try {
    return parsePublicOrigin(`${protocol}://${host}`);
  } catch {
    return "";
  }
}

export function publicRequestOrigin(
  request: Request,
  configuredPublicUrl = process.env.SLAB_PUBLIC_URL ?? "",
) {
  return (
    configuredPublicOrigin(configuredPublicUrl) || new URL(request.url).origin
  );
}

export function emailSettingsRedirect(
  request: Request,
  result: "connected" | "oauth_failed",
  configuredPublicUrl = process.env.SLAB_PUBLIC_URL ?? "",
) {
  const redirect = new URL(
    "/settings",
    publicRequestOrigin(request, configuredPublicUrl),
  );
  redirect.searchParams.set("tab", "email");
  redirect.searchParams.set("email", result);
  return redirect;
}
