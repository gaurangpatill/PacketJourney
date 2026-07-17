import { BROWSER_LIMITS } from "./limits";

export function sanitizeObservedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, BROWSER_LIMITS.maximumUrlLength);
  } catch {
    return value.slice(0, BROWSER_LIMITS.maximumUrlLength);
  }
}

export function sanitizeConsoleMessage(value: string): { message: string; truncated: boolean } {
  const normalized = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
        ? " "
        : character;
    })
    .join("");
  const truncated = normalized.length > BROWSER_LIMITS.maximumConsoleMessageLength;
  return {
    message: normalized.slice(0, BROWSER_LIMITS.maximumConsoleMessageLength),
    truncated,
  };
}
