"use client";

import { useEffect, useRef } from "react";

export function useOperationalPolling(
  refresh: () => Promise<unknown>,
  intervalMs = 2_000,
) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timeout: number | undefined;

    const schedule = () => {
      if (disposed) return;
      timeout = window.setTimeout(tick, intervalMs);
    };
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        if (document.visibilityState === "visible") {
          await refreshRef.current();
        }
      } catch {
        // Operational pages keep their last known state during transient errors.
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (timeout !== undefined) window.clearTimeout(timeout);
      void tick();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}
