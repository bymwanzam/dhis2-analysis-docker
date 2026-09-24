"use client";

/** Hand the viewer a file without a round trip to the server. */
export function downloadCsv(contents: string, filename: string): void {
  // The BOM keeps Excel from mangling non-ASCII organisation unit names.
  const blob = new Blob([`﻿${contents}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** A filename stem that sorts by date and never collides. */
export function stamped(stem: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  return `${stem}-${date}-${time}`;
}
