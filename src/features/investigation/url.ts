export type UrlValidationResult =
  { ok: true; normalizedUrl: string } | { ok: false; message: string };

export function normalizePublicUrl(value: string): UrlValidationResult {
  const input = value.trim();
  if (!input) {
    return { ok: false, message: "Enter a public website URL." };
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "Only HTTP and HTTPS URLs can be investigated." };
    }
    if (!url.hostname || !url.hostname.includes(".")) {
      return { ok: false, message: "Enter a complete public hostname, such as example.com." };
    }
    if (url.username || url.password) {
      return { ok: false, message: "URLs containing credentials are not accepted." };
    }
    url.hash = "";
    return { ok: true, normalizedUrl: url.toString() };
  } catch {
    return { ok: false, message: "This does not look like a valid URL." };
  }
}
