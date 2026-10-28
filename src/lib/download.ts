"use client";

/** Hand the viewer a file without a round trip to the server. */
export function downloadCsv(contents: string, filename: string): void {
  // The BOM keeps Excel from mangling non-ASCII organisation unit names.
  const blob = new Blob([`﻿${contents}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

/** Download structured data as a formatted JSON file. */
export function downloadJson(contents: unknown, filename: string): void {
  const serialized = JSON.stringify(contents, null, 2);
  if (serialized === undefined) {
    throw new Error("The selected data could not be serialized as JSON.");
  }
  downloadBlob(new Blob([serialized], { type: "application/json;charset=utf-8" }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
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
