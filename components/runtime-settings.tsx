"use client";

import { useCallback, useState } from "react";
import {
  ChevronRight,
  KeyRound,
  LoaderCircle,
  Save,
  TestTube2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client-api";
import type { RuntimeCatalogItem } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { CodexAuthSettings } from "@/components/codex-auth-settings";
import { SettingSection } from "@/components/settings-layout";

function healthVariant(runtime: RuntimeCatalogItem) {
  if (runtime.health === "available") return "default" as const;
  if (runtime.health === "unavailable") return "destructive" as const;
  return "secondary" as const;
}

export function RuntimeSettings({
  initialRuntimes,
}: {
  initialRuntimes: RuntimeCatalogItem[];
}) {
  const [runtimes, setRuntimes] = useState(initialRuntimes);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function replace(next: RuntimeCatalogItem) {
    setRuntimes((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
  }

  function configurationBody(
    runtime: RuntimeCatalogItem,
    options: { includeEnabled?: boolean } = {},
  ) {
    return {
      ...(options.includeEnabled ? { enabled: runtime.enabled } : {}),
      defaultModel: runtime.defaultModel,
      ...(keys[runtime.id] ? { apiKey: keys[runtime.id] } : {}),
      ...(runtime.id === "direct_api"
        ? {
            baseUrl: runtime.baseUrl,
            apiFormat: runtime.apiFormat,
          }
        : {}),
      ...(runtime.id === "openrouter" && runtime.providerRouting
        ? {
            requireParameters: runtime.providerRouting.requireParameters,
            dataCollection: runtime.providerRouting.dataCollection,
            zdr: runtime.providerRouting.zdr,
          }
        : {}),
    };
  }

  const refreshRuntimeHealth = useCallback(async (runtimeId: string) => {
    const next = await api<RuntimeCatalogItem[]>("/api/runtimes");
    const refreshed = next.find(({ id }) => id === runtimeId);
    if (!refreshed) return;
    setRuntimes((current) =>
      current.map((item) =>
        item.id === runtimeId
          ? {
              ...item,
              displayName: refreshed.displayName,
              stability: refreshed.stability,
              authModes: refreshed.authModes,
              capabilities: refreshed.capabilities,
              registered: refreshed.registered,
              configured: refreshed.configured,
              health: refreshed.health,
              healthDetail: refreshed.healthDetail,
              lastVerifiedAt: refreshed.lastVerifiedAt,
              configVersion: refreshed.configVersion,
            }
          : item,
      ),
    );
  }, []);
  const refreshCodexHealth = useCallback(
    () => refreshRuntimeHealth("codex"),
    [refreshRuntimeHealth],
  );

  async function save(runtime: RuntimeCatalogItem) {
    setBusy(`${runtime.id}:save`);
    try {
      const next = await api<RuntimeCatalogItem>(
        `/api/runtimes/${runtime.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(
            configurationBody(runtime, { includeEnabled: true }),
          ),
        },
      );
      replace(next);
      setKeys((current) => ({ ...current, [runtime.id]: "" }));
      toast.success(`${runtime.displayName} configuration saved`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save runtime",
      );
    } finally {
      setBusy(null);
    }
  }

  async function test(runtime: RuntimeCatalogItem) {
    setBusy(`${runtime.id}:test`);
    try {
      let current = runtime;
      if (
        keys[runtime.id] ||
        runtime.id === "direct_api" ||
        runtime.id === "openrouter"
      ) {
        current = await api<RuntimeCatalogItem>(`/api/runtimes/${runtime.id}`, {
          method: "PATCH",
          body: JSON.stringify(configurationBody(runtime)),
        });
        replace(current);
        setKeys((values) => ({ ...values, [runtime.id]: "" }));
      }
      const next = await api<RuntimeCatalogItem>(
        `/api/runtimes/${runtime.id}/test`,
        { method: "POST" },
      );
      replace(next);
      toast.success(`${runtime.displayName} is ready`);
    } catch (error) {
      await refreshRuntimeHealth(runtime.id).catch(() => undefined);
      toast.error(
        error instanceof Error ? error.message : "Runtime test failed",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingSection
      title="Available runtimes"
      description="Agents select from enabled runtimes. Open a provider only when you need to configure it."
    >
      {runtimes.map((runtime) => (
        <details key={runtime.id} className="group">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{runtime.displayName}</h3>
                <Badge variant={healthVariant(runtime)}>
                  {runtime.health.replaceAll("_", " ")}
                </Badge>
                {runtime.stability === "experimental" ? (
                  <Badge variant="outline">Experimental</Badge>
                ) : null}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {runtime.configured
                  ? `${runtime.defaultModel === "default" ? "Provider default model" : runtime.defaultModel} · ${runtime.healthDetail}`
                  : runtime.healthDetail}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
              Configure
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            </span>
          </summary>

          <div className="grid gap-4 pb-4 pt-1">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted p-3">
              <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                {runtime.healthDetail}
              </p>
              <label className="flex items-center gap-2 text-xs font-semibold">
                Enabled
                <Switch
                  checked={runtime.enabled}
                  onCheckedChange={(enabled) =>
                    replace({ ...runtime, enabled })
                  }
                  disabled={!runtime.registered}
                  aria-label={`Enable ${runtime.displayName}`}
                />
              </label>
            </div>

            {runtime.id === "direct_api" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-semibold">
                  API base URL
                  <Input
                    value={runtime.baseUrl ?? ""}
                    placeholder="https://api.openai.com/v1"
                    onChange={(event) =>
                      replace({ ...runtime, baseUrl: event.target.value })
                    }
                    inputMode="url"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold">
                  API protocol
                  <Select
                    value={runtime.apiFormat ?? "responses"}
                    onValueChange={(apiFormat) =>
                      replace({
                        ...runtime,
                        apiFormat: apiFormat as RuntimeCatalogItem["apiFormat"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="responses">
                        OpenAI Responses
                      </SelectItem>
                      <SelectItem value="chat_completions">
                        OpenAI-compatible Chat Completions
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
            ) : null}

            {runtime.id === "codex" ? (
              <CodexAuthSettings
                registered={runtime.registered}
                onAuthenticationChanged={refreshCodexHealth}
              />
            ) : null}

            {runtime.id === "openrouter" && runtime.providerRouting ? (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
                <label className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    <span className="block font-semibold">
                      Require all request parameters
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      Route only to providers that support every parameter Slab
                      sends, including tools and output controls.
                    </span>
                  </span>
                  <Switch
                    className="mt-0.5 shrink-0"
                    checked={runtime.providerRouting.requireParameters}
                    onCheckedChange={(requireParameters) =>
                      replace({
                        ...runtime,
                        providerRouting: {
                          ...runtime.providerRouting!,
                          requireParameters,
                        },
                      })
                    }
                    aria-label="Require OpenRouter request parameter support"
                  />
                </label>
                <label className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    <span className="block font-semibold">
                      Deny data collection
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      Exclude providers that may retain prompts for training or
                      analytics.
                    </span>
                  </span>
                  <Switch
                    className="mt-0.5 shrink-0"
                    checked={runtime.providerRouting.dataCollection === "deny"}
                    onCheckedChange={(deny) =>
                      replace({
                        ...runtime,
                        providerRouting: {
                          ...runtime.providerRouting!,
                          dataCollection: deny ? "deny" : "allow",
                        },
                      })
                    }
                    aria-label="Deny OpenRouter provider data collection"
                  />
                </label>
                <label className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    <span className="block font-semibold">
                      Zero data retention only
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      Use only endpoints with a zero-data-retention policy.
                    </span>
                  </span>
                  <Switch
                    className="mt-0.5 shrink-0"
                    checked={runtime.providerRouting.zdr}
                    onCheckedChange={(zdr) =>
                      replace({
                        ...runtime,
                        providerRouting: {
                          ...runtime.providerRouting!,
                          zdr,
                        },
                      })
                    }
                    aria-label="Require OpenRouter zero data retention"
                  />
                </label>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end">
              {runtime.authMode === "api_key" ? (
                <label className="grid gap-1.5 text-xs font-semibold">
                  {runtime.id === "claude"
                    ? "Anthropic API key"
                    : runtime.id === "openrouter"
                      ? "OpenRouter API key"
                      : "Provider API key"}
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      type="password"
                      value={keys[runtime.id] ?? ""}
                      placeholder={
                        runtime.configured
                          ? "Configured · replace only"
                          : runtime.id === "claude"
                            ? "sk-ant-…"
                            : runtime.id === "openrouter"
                              ? "sk-or-v1-…"
                              : "Write-only credential"
                      }
                      onChange={(event) =>
                        setKeys((current) => ({
                          ...current,
                          [runtime.id]: event.target.value,
                        }))
                      }
                      autoComplete="new-password"
                    />
                  </div>
                </label>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {runtime.id === "gemini"
                    ? "Google account authentication is stored inside slab-runner. Run sudo slabctl gemini login on the host."
                    : "Account authentication is managed above."}
                </div>
              )}
              <label className="grid gap-1.5 text-xs font-semibold">
                Workspace default model
                <Select
                  value={runtime.defaultModel}
                  onValueChange={(defaultModel) =>
                    replace({ ...runtime, defaultModel })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runtime.models.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model === "default" ? "Provider default" : model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <Button
                variant="outline"
                onClick={() => test(runtime)}
                disabled={busy !== null || !runtime.registered}
              >
                {busy === `${runtime.id}:test` ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <TestTube2 />
                )}
                Test
              </Button>
              <Button onClick={() => save(runtime)} disabled={busy !== null}>
                {busy === `${runtime.id}:save` ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {runtime.models.length} model option
              {runtime.models.length === 1 ? "" : "s"} · config revision{" "}
              {runtime.configVersion}
              {runtime.lastVerifiedAt
                ? ` · verified ${formatDateTime(runtime.lastVerifiedAt)}`
                : ""}
            </p>
          </div>
        </details>
      ))}
    </SettingSection>
  );
}
