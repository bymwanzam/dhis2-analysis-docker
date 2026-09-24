"use client";

import * as React from "react";

/** Delay a fast-changing value so search does not fire on every keystroke. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * State mirrored into localStorage, so a workbench keeps its selection across
 * a reload.
 *
 * The stored value is deliberately read *after* mount rather than in the
 * initialiser: the server renders the default, so reading early would make
 * the first client render disagree with the server and break hydration.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [state, setState] = React.useState<T>(initial);
  const [hydrated, setHydrated] = React.useState(false);

  // `initial` is a fallback only; depending on it directly would re-run the
  // read on every new object identity and wipe the user's selection.
  const initialRef = React.useRef(initial);

  React.useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      // A blocked store just means we start from the default.
    }
    // The stored value cannot be read until the server-rendered markup has
    // hydrated, so this one catch-up update has to happen in an effect.
    //
    // A key with nothing behind it resets to the default rather than keeping
    // whatever the previous key held: the key identifies the scope of the
    // value, so carrying state across a key change would leak one scope's
    // selection into another.
    setState(stored ? parse(stored, initialRef.current) : initialRef.current);
    setHydrated(true);
  }, [key]);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Private mode and full quotas are not worth failing a query over.
    }
  }, [key, state, hydrated]);

  return [state, setState, hydrated];
}

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface AsyncData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * One request per dependency change, cancelled when the dependencies change
 * again or the component unmounts.
 *
 * Every fetch in this app goes through here, which is why the single
 * "a request has started" state update is allowed to live in an effect: that
 * is what a fetch effect is, and keeping it in one hook keeps it out of the
 * nine components that would otherwise each write their own.
 */
export function useAsyncData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
): AsyncData<T> {
  const loaderRef = React.useRef(loader);
  React.useEffect(() => {
    loaderRef.current = loader;
  });

  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<{
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });

  React.useEffect(() => {
    const controller = new AbortController();

    // A fetch effect has to be able to say that it started; see the note above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) => ({ ...current, loading: true, error: null }));

    loaderRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          error: cause instanceof Error ? cause.message : "Something went wrong.",
          loading: false,
        });
      },
    );

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller owns the deps.
  }, [...deps, nonce]);

  const reload = React.useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}
