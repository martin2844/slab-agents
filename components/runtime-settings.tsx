"use client";

import { useState } from "react";
import { KeyRound, LoaderCircle, Save, TestTube2 } from "lucide-react";
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

  async function save(runtime: RuntimeCatalogItem) {
    setBusy(`${runtime.id}:save`);
    try {
      const next = await api<RuntimeCatalogItem>(
        `/api/runtimes/${runtime.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: runtime.enabled,
            defaultModel: runtime.defaultModel,
            ...(keys[runtime.id] ? { apiKey: keys[runtime.id] } : {}),
            ...(runtime.id === "direct_api"
              ? {
                  baseUrl: runtime.baseUrl,
                  apiFormat: runtime.apiFormat,
                }
              : {}),
          }),
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
      if (keys[runtime.id] || runtime.id === "direct_api") {
        current = await api<RuntimeCatalogItem>(`/api/runtimes/${runtime.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(keys[runtime.id] ? { apiKey: keys[runtime.id] } : {}),
            ...(runtime.id === "direct_api"
              ? {
                  baseUrl: runtime.baseUrl,
                  apiFormat: runtime.apiFormat,
                }
              : {}),
          }),
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
      toast.error(
        error instanceof Error ? error.message : "Runtime test failed",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 divide-y rounded-md border">
      {runtimes.map((runtime) => (
        <div key={runtime.id} className="grid gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{runtime.displayName}</h3>
                <Badge variant={healthVariant(runtime)}>
                  {runtime.health.replaceAll("_", " ")}
                </Badge>
                {runtime.stability === "experimental" ? (
                  <Badge variant="outline">Experimental</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {runtime.healthDetail}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              Enabled
              <Switch
                checked={runtime.enabled}
                onCheckedChange={(enabled) => replace({ ...runtime, enabled })}
                disabled={!runtime.registered}
                aria-label={`Enable ${runtime.displayName}`}
              />
            </div>
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
                    <SelectItem value="responses">OpenAI Responses</SelectItem>
                    <SelectItem value="chat_completions">
                      OpenAI-compatible Chat Completions
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end">
            {runtime.authMode === "api_key" ? (
              <label className="grid gap-1.5 text-xs font-semibold">
                {runtime.id === "claude"
                  ? "Anthropic API key"
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
                  : "Authentication is stored inside slab-runner."}
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
      ))}
    </div>
  );
}
