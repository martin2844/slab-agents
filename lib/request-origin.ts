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

export function publicRequestOrigin(
  request: Request,
  configuredPublicUrl = process.env.SLAB_PUBLIC_URL ?? "",
) {
  const configured = configuredPublicUrl.trim();
  return configured
    ? parsePublicOrigin(configured)
    : new URL(request.url).origin;
}
