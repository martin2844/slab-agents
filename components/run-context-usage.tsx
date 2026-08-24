import { Activity, Database, Gauge, Terminal, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  RunContextProfile,
  ToolCallProfile,
} from "@/lib/run-context-profile";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function tokens(value: number | null) {
  return value === null ? "Not captured" : integer.format(value);
}

function bytes(value: number) {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function duration(value: number | null) {
  if (value === null) return "In progress";
  if (value < 1_000) return `${value} ms`;
  const seconds = Math.round(value / 1_000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : `${date.toISOString().slice(11, 19)} UTC`;
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-xl tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs leading-5 text-muted-foreground">
        {note}
      </CardContent>
    </Card>
  );
}

function PayloadPreview({ call }: { call: ToolCallProfile }) {
  if (
    !call.argumentsPreview &&
    !call.responsePreview &&
    !call.command &&
    call.debugArgumentsPayload === null &&
    call.debugResponsePayload === null &&
    !call.searchQuery &&
    !call.reason
  ) {
    return null;
  }
  return (
    <details className="mt-2 min-w-0 max-w-full text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none hover:text-foreground">
        Inspect redacted preview
      </summary>
      <div className="mt-2 grid min-w-0 max-w-full gap-2">
        {call.reason && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            Tool lifecycle failure: <code>{call.reason}</code>
          </div>
        )}
        {call.searchQuery && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium text-foreground">
              Search: <code>{call.searchQuery}</code>
            </p>
            <ul className="mt-2 space-y-1.5">
              {call.searchResults.map((result, index) => (
                <li
                  key={`${result.id ?? result.slug ?? result.title}-${index}`}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span>
                    {result.title}
                    {(result.slug || result.id) && (
                      <span className="ml-2 font-mono text-[0.68rem] text-muted-foreground">
                        {result.slug ?? result.id}
                      </span>
                    )}
                  </span>
                  {result.score !== null && (
                    <span className="font-mono text-[0.68rem] text-muted-foreground">
                      score {result.score.toPrecision(4)}
                    </span>
                  )}
                </li>
              ))}
              {call.searchResults.length === 0 && (
                <li className="text-muted-foreground">
                  No result metadata captured
                  {call.searchResultCount !== null
                    ? ` (${call.searchResultCount} results)`
                    : ""}
                </li>
              )}
            </ul>
          </div>
        )}
        {call.command && (
          <pre className="max-w-full overflow-auto rounded-md bg-muted/70 p-3 font-mono leading-5 text-foreground">
            {call.command}
          </pre>
        )}
        {call.argumentsPreview && (
          <div>
            <p className="mb-1 font-medium text-foreground">Arguments</p>
            <pre className="max-h-40 max-w-full overflow-auto rounded-md bg-muted/70 p-3 font-mono leading-5 text-foreground">
              {call.argumentsPreview}
            </pre>
          </div>
        )}
        {call.responsePreview && (
          <div>
            <p className="mb-1 font-medium text-foreground">Response</p>
            <pre className="max-h-48 max-w-full overflow-auto rounded-md bg-muted/70 p-3 font-mono leading-5 text-foreground">
              {call.responsePreview}
            </pre>
          </div>
        )}
        {(call.debugArgumentsPayload !== null ||
          call.debugResponsePayload !== null) && (
          <details className="rounded-md border border-dashed p-3">
            <summary className="cursor-pointer font-medium text-foreground">
              Full sanitized debug payload
            </summary>
            {call.debugArgumentsPayload !== null && (
              <pre className="mt-2 max-h-80 overflow-auto bg-muted/70 p-3 font-mono leading-5 text-foreground">
                {JSON.stringify(call.debugArgumentsPayload, null, 2)}
              </pre>
            )}
            {call.debugResponsePayload !== null && (
              <pre className="mt-2 max-h-80 overflow-auto bg-muted/70 p-3 font-mono leading-5 text-foreground">
                {JSON.stringify(call.debugResponsePayload, null, 2)}
              </pre>
            )}
          </details>
        )}
      </div>
    </details>
  );
}

export function RunContextUsage({
  profile,
  runtimeSkipped = false,
}: {
  profile: RunContextProfile;
  runtimeSkipped?: boolean;
}) {
  const aggregateUsage = profile.modelCallCount === null;
  return (
    <section className="space-y-5" aria-labelledby="context-usage-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Profiling
          </p>
          <h2 id="context-usage-title" className="mt-1 text-xl font-semibold">
            Context / Usage
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {aggregateUsage
              ? "Aggregate runtime usage with tool traffic. Per-call context boundaries are unavailable."
              : "Per-call runtime usage correlated with tool traffic."} Byte
            sizes are exact; approximate tokens use characters ÷ 4.
          </p>
        </div>
        <Badge variant={profile.captured ? "secondary" : "outline"}>
          {runtimeSkipped
            ? "Runtime not started"
            : profile.captured
              ? "Profiling captured"
              : "Legacy run"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Initial model-call input"
          value={
            runtimeSkipped ? "0" : tokens(profile.initialModelCallInputTokens)
          }
          note={`${tokens(profile.knownInitialContextApproxTokens)} known bootstrap tokens`}
        />
        <Metric
          label="Peak model-call input"
          value={tokens(profile.peakModelCallInputTokens)}
          note={`${profile.contextGrowthTokens !== null && profile.contextGrowthTokens >= 0 ? "+" : ""}${tokens(profile.contextGrowthTokens)} from the first call`}
        />
        <Metric
          label="Cumulative input"
          value={tokens(profile.cumulativeInputTokens)}
          note={`${tokens(profile.cumulativeCachedInputTokens)} cached · ${tokens(profile.cumulativeUncachedInputTokens)} uncached`}
        />
        <Metric
          label={aggregateUsage ? "Provider turns" : "Model calls"}
          value={tokens(
            aggregateUsage
              ? profile.providerTurnCount
              : profile.modelCallCount,
          )}
          note={`${tokens(profile.cumulativeOutputTokens)} output · ${tokens(profile.cumulativeReasoningOutputTokens)} reasoning`}
        />
        <Metric
          label="Tool calls"
          value={tokens(profile.toolCalls.length)}
          note={`${tokens(profile.repeatedCalls.length)} repeated tool patterns`}
        />
        <Metric
          label="MCP response payload"
          value={`≈${tokens(profile.mcpResponseApproxTokens)}`}
          note={`${tokens(profile.toolResponseApproxTokens)} across all tool responses`}
        />
        <Metric
          label="Context window"
          value={tokens(profile.modelContextWindow)}
          note="Reported by the selected runtime"
        />
        <Metric
          label="Run duration"
          value={duration(profile.durationMs)}
          note={`${profile.shellCalls.length} shell call${profile.shellCalls.length === 1 ? "" : "s"}`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4" /> Initial context we control
            </CardTitle>
            <CardDescription>
              Known serialized inputs, compared with the first model call. The
              remainder can include Codex runtime context and formatting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Known approx</p>
                <p className="mt-1 font-mono font-semibold">
                  {tokens(profile.knownInitialContextApproxTokens)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">First call</p>
                <p className="mt-1 font-mono font-semibold">
                  {tokens(profile.initialModelCallInputTokens)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Not attributed</p>
                <p className="mt-1 font-mono font-semibold">
                  {tokens(profile.unattributedInitialContextApproxTokens)}
                </p>
              </div>
            </div>
            <div className="divide-y">
              {profile.contextComponents.map((component) => (
                <div
                  key={component.key}
                  className="flex items-center justify-between gap-4 py-2.5 text-sm"
                >
                  <span>{component.label}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {bytes(component.bytes)} · ≈{tokens(component.approxTokens)}{" "}
                    tok
                  </span>
                </div>
              ))}
              {profile.contextComponents.length === 0 && (
                <p className="py-3 text-sm text-muted-foreground">
                  {runtimeSkipped
                    ? "Preflight skipped this run before runtime bootstrap."
                    : "Bootstrap metrics were not captured for this run."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" /> MCP definitions
            </CardTitle>
            <CardDescription>
              Serialized `tools/list` definitions observed independently for
              each configured server. Schema bodies are not stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.mcpServers.map((server) => (
              <details
                key={server.server}
                className="rounded-lg border p-3"
                open
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span className="font-medium capitalize">
                    {server.server}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {server.success
                      ? `${server.toolCount} tools · ${bytes(server.bytes)} · ≈${tokens(server.approxTokens)} tok`
                      : "Probe failed"}
                  </span>
                </summary>
                {server.success ? (
                  <div className="mt-3 max-h-52 divide-y overflow-auto border-t">
                    {server.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-center justify-between gap-3 py-2 text-xs"
                      >
                        <code>{tool.name}</code>
                        <span className="font-mono text-muted-foreground">
                          ≈{tokens(tool.approxTokens)} tok
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-destructive">
                    {server.error}
                  </p>
                )}
              </details>
            ))}
            {profile.mcpServers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                MCP definition sizes were not captured for this run.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4" /> Usage reports
          </CardTitle>
          <CardDescription>
            {aggregateUsage
              ? "The provider reports one aggregate for the Run; it is not presented as an individual model call."
              : "Each row is one model-call usage update; totals are sums of individual calls."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Report</th>
                <th className="pb-2 font-medium">Input</th>
                <th className="pb-2 font-medium">Δ input</th>
                <th className="pb-2 font-medium">Cached</th>
                <th className="pb-2 font-medium">Uncached</th>
                <th className="pb-2 font-medium">Output</th>
                <th className="pb-2 font-medium">Reasoning</th>
                <th className="pb-2 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono text-xs tabular-nums">
              {profile.modelCalls.map((call) => (
                <tr key={`${call.callIndex}-${call.createdAt}`}>
                  <td className="py-2.5">
                    {call.usageScope === "run_aggregate"
                      ? "Run aggregate"
                      : call.callIndex}
                  </td>
                  <td className="py-2.5">{tokens(call.inputTokens)}</td>
                  <td className="py-2.5">
                    {call.inputDeltaTokens === null
                      ? "—"
                      : `${call.inputDeltaTokens >= 0 ? "+" : ""}${tokens(call.inputDeltaTokens)}`}
                  </td>
                  <td className="py-2.5">{tokens(call.cachedInputTokens)}</td>
                  <td className="py-2.5">{tokens(call.uncachedInputTokens)}</td>
                  <td className="py-2.5">{tokens(call.outputTokens)}</td>
                  <td className="py-2.5">
                    {tokens(call.reasoningOutputTokens)}
                  </td>
                  <td className="py-2.5 text-right text-muted-foreground">
                    {time(call.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {profile.modelCalls.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              No model-call usage updates were persisted.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-4" /> Tool breakdown
            </CardTitle>
            <CardDescription>
              Calls and serialized response weight grouped by server and tool.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Tool</th>
                  <th className="pb-2 text-right font-medium">Calls</th>
                  <th className="pb-2 text-right font-medium">Responses</th>
                  <th className="pb-2 text-right font-medium">Largest</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {profile.toolBreakdown.map((tool) => (
                  <tr key={tool.key}>
                    <td className="py-2.5 font-mono text-xs">{tool.key}</td>
                    <td className="py-2.5 text-right font-mono text-xs">
                      {tool.calls}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs">
                      ≈{tokens(tool.responseApproxTokens)} tok
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs text-muted-foreground">
                      ≈{tokens(tool.largestResponseApproxTokens)} tok
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {profile.toolBreakdown.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                No completed tool calls were persisted.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Largest responses</CardTitle>
            <CardDescription>
              Single responses most likely to correlate with later context
              growth.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {profile.largestResponses.map((call, index) => (
              <div key={call.toolId} className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-mono text-xs">
                    {index + 1}.{" "}
                    {call.server === "runtime"
                      ? call.tool
                      : `${call.server}.${call.tool}`}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    ≈{tokens(call.responseApproxTokens)} tok
                  </span>
                </div>
                <PayloadPreview call={call} />
              </div>
            ))}
            {profile.largestResponses.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No response metrics yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {profile.shellCalls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4" /> Shell calls
            </CardTitle>
            <CardDescription>
              Commands are redacted. Codex currently returns stdout and stderr
              as one aggregate output stream.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {profile.shellCalls.map((call) => (
              <div key={call.toolId} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge
                    variant={
                      call.success === null
                        ? "outline"
                        : call.success
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {call.success === null
                      ? "Not captured"
                      : call.success
                        ? "Succeeded"
                        : "Failed"}
                  </Badge>
                  <span className="font-mono">
                    exit {call.exitCode ?? "unknown"}
                  </span>
                  <span className="text-muted-foreground">
                    {duration(call.durationMs)} · {bytes(call.outputBytes ?? 0)}{" "}
                    · ≈{tokens(call.outputApproxTokens ?? 0)} tok output
                  </span>
                </div>
                <PayloadPreview call={call} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Correlated model / tool sequence</CardTitle>
          <CardDescription>
            {aggregateUsage
              ? "Tool events keep their original times; aggregate usage appears at the provider summary boundary."
              : "Tools are grouped after the model-call boundary that produced them; shown times are the original event times. A later input delta may include runtime context that this control plane cannot attribute."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative ml-2 border-l pl-6">
            {profile.timeline.map((entry) => {
              const isModel = entry.entryType === "model";
              const entryTime = isModel ? entry.createdAt : entry.completedAt;
              return (
                <div
                  key={
                    isModel
                      ? `model-${entry.callIndex}-${entry.createdAt}`
                      : `tool-${entry.toolId}`
                  }
                  className="relative pb-5 last:pb-0"
                >
                  <span
                    className={`absolute -left-[1.77rem] top-1 size-2.5 rounded-full ring-4 ring-background ${isModel ? "bg-primary" : entry.success === false ? "bg-destructive" : "bg-amber-500"}`}
                  />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <time className="font-mono text-xs text-muted-foreground">
                      {time(entryTime)}
                    </time>
                    {isModel ? (
                      <>
                        <strong>
                          {entry.usageScope === "run_aggregate"
                            ? "Run aggregate usage"
                            : `Model call ${entry.callIndex}`}
                        </strong>
                        <span className="font-mono text-xs">
                          input {tokens(entry.inputTokens)}
                          {entry.inputDeltaTokens !== null
                            ? ` (${entry.inputDeltaTokens >= 0 ? "+" : ""}${tokens(entry.inputDeltaTokens)})`
                            : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tokens(entry.cachedInputTokens)} cached
                        </span>
                      </>
                    ) : (
                      <>
                        <strong className="font-mono text-xs">
                          {entry.server === "runtime"
                            ? entry.tool
                            : `${entry.server}.${entry.tool}`}
                        </strong>
                        <span className="text-xs text-muted-foreground">
                          request ≈{tokens(entry.argumentsApproxTokens)} ·
                          response ≈{tokens(entry.responseApproxTokens)} tok
                        </span>
                      </>
                    )}
                  </div>
                  {!isModel && <PayloadPreview call={entry} />}
                </div>
              );
            })}
            {profile.timeline.length === 0 && (
              <p className="pb-1 text-sm text-muted-foreground">
                No model or tool events were captured.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {profile.limitations.length > 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Measurement notes
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
            {profile.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
