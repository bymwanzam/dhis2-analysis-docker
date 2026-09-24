"use client";

import * as React from "react";
import { useConnection } from "@/components/connection-provider";
import { fetchAnalytics } from "@/lib/dhis2/client";
import { parseAnalytics, type ParsedAnalytics } from "@/lib/dhis2/analytics";
import { usePersistentState } from "@/lib/hooks";
import type { AnalyticsQuery } from "@/lib/dhis2/analytics";

export interface AnalyticsSession<S> {
  query: S;
  setQuery: React.Dispatch<React.SetStateAction<S>>;
  /** The stored query has been read back from localStorage. */
  hydrated: boolean;
  result: ParsedAnalytics | null;
  /**
   * The request that produced `result`. The selection may have moved on since,
   * so anything that has to line up with the result — the map's boundaries —
   * reads this rather than the current query.
   */
  resultQuery: AnalyticsQuery | null;
  error: string | null;
  running: boolean;
  /** The selection differs from the one that produced the current result. */
  dirty: boolean;
  run: () => Promise<void>;
}

/**
 * One analytics query and its result, with the in-flight request cancelled
 * whenever a newer one starts so a slow query can never overwrite a fast one.
 *
 * The state shape is the caller's: each workbench keeps whatever its pickers
 * produce and supplies the function that turns it into an analytics request.
 *
 * The saved selection is scoped to the server that issued it. Data element and
 * organisation unit ids mean nothing on another DHIS2 instance, and analytics
 * answers a query full of unknown ids with an empty result rather than an
 * error — so an unscoped query replayed against a new server looks exactly
 * like a server that holds no data.
 */
export function useAnalyticsSession<S>(
  storageKey: string,
  initial: S,
  toQuery: (state: S) => AnalyticsQuery,
): AnalyticsSession<S> {
  const { status } = useConnection();
  const scopedKey = `${storageKey}::${status?.baseUrl ?? "unset"}`;

  const [query, setQuery, hydrated] = usePersistentState<S>(scopedKey, initial);
  const [result, setResult] = React.useState<ParsedAnalytics | null>(null);
  const [resultQuery, setResultQuery] = React.useState<AnalyticsQuery | null>(null);
  const [ranSignature, setRanSignature] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const requestRef = React.useRef<AbortController | null>(null);
  const toQueryRef = React.useRef(toQuery);
  React.useEffect(() => {
    toQueryRef.current = toQuery;
  });

  const signature = JSON.stringify(toQuery(query));

  const run = React.useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setRunning(true);
    setError(null);

    try {
      const request = toQueryRef.current(query);
      const response = await fetchAnalytics(request, controller.signal);
      if (controller.signal.aborted) return;
      setResult(parseAnalytics(response));
      setResultQuery(request);
      setRanSignature(signature);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      setResult(null);
      setResultQuery(null);
      setError(cause instanceof Error ? cause.message : "The query failed.");
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }, [query, signature]);

  React.useEffect(() => () => requestRef.current?.abort(), []);

  return {
    query,
    setQuery,
    hydrated,
    result,
    resultQuery,
    error,
    running,
    dirty: ranSignature !== signature,
    run,
  };
}
