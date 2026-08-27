"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Server } from "lucide-react";
import { useSystemUpdatesStore } from "@/components/system-updates-store";
import { deriveSystemUpdateSidebarState } from "@/lib/system-update-view-model";
import { cn } from "@/lib/utils";

export function SystemUpdateNavItem({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { data } = useSystemUpdatesStore();
  const updateState = deriveSystemUpdateSidebarState(data?.requests ?? []);
  const bridgeUnavailable = data ? !data.bridge.available : false;
  const version = updateState.installedVersion
    ? `v${updateState.installedVersion}`
    : "Version unknown";
  const statusLabel = bridgeUnavailable
    ? `${updateState.statusLabel}; host bridge unavailable`
    : updateState.statusLabel;
  const visibleStatus = bridgeUnavailable
    ? `${version} · Bridge offline`
    : updateState.attention === "update_in_progress"
      ? "Updating stack…"
      : version;
  const visibleAttention = bridgeUnavailable
    ? "bridge_unavailable"
    : updateState.attention;

  return (
    <Link
      href="/system"
      onClick={onNavigate}
      title={statusLabel}
      aria-label={`System. Installed ${version}. ${statusLabel}.`}
      className={cn(
        "group relative mt-2 flex min-h-11 items-center gap-2.5 rounded-md border px-3 py-2 text-sidebar-foreground transition-[background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        pathname.startsWith("/system")
          ? "border-sidebar-primary/45 bg-sidebar-accent"
          : "border-sidebar-border bg-sidebar-accent/55 hover:border-sidebar-foreground/20 hover:bg-sidebar-accent",
      )}
    >
      <Server className="size-3.5 shrink-0 text-sidebar-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">System</span>
        <span className="mt-0.5 block truncate font-mono text-[0.64rem] text-sidebar-foreground/55">
          {visibleStatus}
        </span>
      </span>
      {visibleAttention ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full ring-2 ring-sidebar",
            ["update_available", "update_in_progress"].includes(
              visibleAttention,
            )
              ? "bg-amber-400"
              : "bg-red-400",
          )}
        />
      ) : null}
    </Link>
  );
}
