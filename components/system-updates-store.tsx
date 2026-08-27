"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { api } from "@/lib/client-api";
import { SystemUpdatesDataCoordinator } from "@/lib/system-update-view-model";
import type { SystemUpdatesData } from "@/lib/types";

type SystemUpdatesStoreValue = {
  data: SystemUpdatesData | null;
  refresh: () => Promise<SystemUpdatesData | null>;
  commitData: (
    update: (current: SystemUpdatesData | null) => SystemUpdatesData,
  ) => void;
  seedData: (initialData: SystemUpdatesData) => void;
};

const SystemUpdatesStore = createContext<SystemUpdatesStoreValue | null>(null);

export function SystemUpdatesStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [data, setData] = useState<SystemUpdatesData | null>(null);
  const dataCoordinatorRef = useRef(new SystemUpdatesDataCoordinator());

  const refresh = useCallback(async () => {
    const response = dataCoordinatorRef.current.beginRead();
    const next = await api<SystemUpdatesData>("/api/system/updates");
    const accepted = dataCoordinatorRef.current.commitRead(response, next);
    if (accepted) setData(accepted);
    return accepted;
  }, []);

  useEffect(() => {
    const dataCoordinator = dataCoordinatorRef.current;
    void refresh().catch(() => undefined);
    return () => dataCoordinator.invalidate();
  }, [pathname, refresh]);
  useOperationalPolling(
    refresh,
    pathname.startsWith("/system") ? 3_000 : 60_000,
  );

  const commitData = useCallback<SystemUpdatesStoreValue["commitData"]>(
    (update) => {
      dataCoordinatorRef.current.invalidate();
      setData(update);
    },
    [],
  );
  const seedData = useCallback((initialData: SystemUpdatesData) => {
    setData(dataCoordinatorRef.current.seed(initialData));
  }, []);
  const value = useMemo(
    () => ({ data, refresh, commitData, seedData }),
    [commitData, data, refresh, seedData],
  );

  return (
    <SystemUpdatesStore.Provider value={value}>
      {children}
    </SystemUpdatesStore.Provider>
  );
}

export function useSystemUpdatesStore() {
  const store = useContext(SystemUpdatesStore);
  if (!store) {
    throw new Error("System update state requires SystemUpdatesStoreProvider.");
  }
  return store;
}
