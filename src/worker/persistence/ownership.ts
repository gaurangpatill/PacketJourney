import { randomToken, sha256Hex } from "./crypto";

const COOKIE_NAME = "pj_installation";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function cookieValue(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const item of header.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === COOKIE_NAME) {
      const value = parts.join("=");
      if (/^[A-Za-z0-9_-]{43}$/.test(value)) return value;
    }
  }
  return undefined;
}

export async function resolveAnonymousOwner(request: Request): Promise<{
  ownerId: string;
  setCookie?: string;
}> {
  const existing = cookieValue(request);
  const value = existing ?? randomToken();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    ownerId: await sha256Hex(value),
    ...(!existing
      ? {
          setCookie: `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ONE_YEAR_SECONDS}${secure}`,
        }
      : {}),
  };
}
