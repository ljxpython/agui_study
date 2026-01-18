export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function isDataUrl(s: string): boolean {
  return s.startsWith("data:");
}

export function extractDataUrls(input: string): string[] {
  // Very small heuristic: find `data:<...>` until whitespace or quotes.
  const re = /(data:[^\s"']+)/g;
  return Array.from(input.matchAll(re)).map((m) => m[1]);
}

export function extractHttpUrls(input: string): string[] {
  const re = /(https?:\/\/[^\s"']+)/g;
  return Array.from(input.matchAll(re)).map((m) => m[1]);
}

export function collectLinkStrings(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (v: unknown) => {
    if (typeof v === "string") {
      const urls = [...extractHttpUrls(v), ...extractDataUrls(v)];
      for (const u of urls) {
        if (!seen.has(u)) {
          seen.add(u);
          out.push(u);
        }
      }
      return;
    }

    if (!v || typeof v !== "object") return;

    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }

    for (const key of Object.keys(v as Record<string, unknown>)) {
      visit((v as Record<string, unknown>)[key]);
    }
  };

  visit(value);
  return out;
}

export async function downloadUrlAsFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function guessFilenameFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).slice(-1)[0];
    return last || fallback;
  } catch {
    return fallback;
  }
}

export function guessExtensionFromDataUrl(dataUrl: string): string {
  // data:text/csv;base64,... or data:image/png;base64,...
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl);
  const mime = m?.[1] ?? "";
  if (mime === "text/csv") return "csv";
  if (mime === "application/json") return "json";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "text/plain") return "txt";
  return "txt";
}
