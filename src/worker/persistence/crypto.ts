const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isValidOpaqueToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
