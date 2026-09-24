"use client";

import * as React from "react";
import { fetchConnectionStatus } from "@/lib/dhis2/client";
import type { ConnectionStatus } from "@/lib/dhis2/types";

interface ConnectionContextValue {
  status: ConnectionStatus | null;
  /** True until the first status check resolves. */
  loading: boolean;
  refresh: () => Promise<ConnectionStatus | null>;
  setStatus: (status: ConnectionStatus) => void;
}

const ConnectionContext = React.createContext<ConnectionContextValue | null>(null);

/**
 * One connection check per page load, shared by the header and every page,
 * so a workbench never opens a second probe just to know it can query.
 */
export function ConnectionProvider({
  hasCredentials,
  children,
}: {
  hasCredentials: boolean;
  children: React.ReactNode;
}) {
  const [status, setStatus] = React.useState<ConnectionStatus | null>(
    hasCredentials ? null : { connected: false },
  );
  const [loading, setLoading] = React.useState(hasCredentials);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchConnectionStatus();
      setStatus(next);
      return next;
    } catch {
      const failed: ConnectionStatus = {
        connected: false,
        error: "Could not check the connection.",
      };
      setStatus(failed);
      return failed;
    } finally {
      setLoading(false);
    }
  }, []);

  // The first check runs without touching state synchronously — `loading`
  // already starts true when there are credentials to verify.
  React.useEffect(() => {
    if (!hasCredentials) return;
    const controller = new AbortController();

    fetchConnectionStatus(controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setStatus(next);
        setLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setStatus({ connected: false, error: "Could not check the connection." });
        setLoading(false);
      },
    );

    return () => controller.abort();
  }, [hasCredentials]);

  const value = React.useMemo(
    () => ({ status, loading, refresh, setStatus }),
    [status, loading, refresh],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const context = React.useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnection must be used inside ConnectionProvider");
  }
  return context;
}
