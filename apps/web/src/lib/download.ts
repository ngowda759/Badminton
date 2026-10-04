/**
 * Triggers a browser download of a JSON-serialisable value.
 *
 * The whole-tournament backup is downloaded client-side (there is no server
 * "save as file" endpoint), so the page assembles the response into a `Blob`,
 * hands the browser a temporary object URL and releases it again. The object URL
 * is always revoked, even if the click fails, so a download never leaks one.
 */
export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A filesystem-safe backup filename stamped with the current time. */
export function backupFilename(name: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug.length > 0 ? slug : 'tournament'}-backup-${stamp}.json`;
}
