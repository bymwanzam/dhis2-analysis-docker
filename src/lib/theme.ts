"use client";

/**
 * Theme as an external store.
 *
 * The chosen theme already lives on <html data-theme>, put there by an inline
 * script before first paint. Reading it through useSyncExternalStore means
 * React never has to set state in an effect to catch up with the DOM, and the
 * server render agrees with the client because both start from "system".
 */

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "dhis2-theme";
const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}

/** The server has no DOM and no storage, so it always renders "system". */
export function getServerTheme(): Theme {
  return "system";
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }

  try {
    if (theme === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // A blocked store costs the preference on the next load, nothing more.
  }

  for (const listener of listeners) listener();
}

export function nextTheme(current: Theme): Theme {
  const order: Theme[] = ["system", "light", "dark"];
  return order[(order.indexOf(current) + 1) % order.length];
}
