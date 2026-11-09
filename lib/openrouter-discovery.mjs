/** @param {Response} response */
async function readJsonLimited(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1_048_576) {
        await reader.cancel();
        throw new Error("Runtime model discovery response is too large.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Shared by Settings and the local installer CLI. No inference is billed.
 * @param {string} credential
 * @param {{zdr?: boolean, fetcher?: typeof fetch}} options
 * @returns {Promise<string[]>}
 */
export async function discoverOpenRouterModels(credential, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  async function request(url, label) {
    const response = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${credential}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`OpenRouter ${label} refused a redirect.`);
    }
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "OpenRouter rejected the configured API key."
          : `OpenRouter ${label} returned ${response.status}.`,
      );
    }
    return readJsonLimited(response);
  }
  const keyPayload = await request(
    "https://openrouter.ai/api/v1/key",
    "key check",
  );
  if (
    !keyPayload?.data ||
    typeof keyPayload.data !== "object" ||
    Array.isArray(keyPayload.data)
  ) {
    throw new Error("OpenRouter key check returned an invalid response.");
  }
  const params = new URLSearchParams({ supported_parameters: "tools" });
  if (options.zdr ?? true) params.set("zdr", "true");
  const payload = await request(
    `https://openrouter.ai/api/v1/models?${params}`,
    "model discovery",
  );
  const models = [
    ...new Set(
      (Array.isArray(payload?.data) ? payload.data : [])
        .filter(
          (model) =>
            Array.isArray(model?.supported_parameters) &&
            model.supported_parameters.includes("tools"),
        )
        .map(({ id }) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0 && id.length <= 200)
        .slice(0, 500),
    ),
  ];
  if (models.length === 0) {
    throw new Error(
      "OpenRouter did not report any tool-capable models for this policy.",
    );
  }
  return models;
}
