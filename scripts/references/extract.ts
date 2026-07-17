import { normalizeReferenceText, type ReferenceSection } from "../../src/references/chunking";
import type { ReferenceManifestEntry } from "../../src/features/references/schema";

function decode(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function stripMarkup(value: string): string {
  return normalizeReferenceText(
    decode(
      value
        .replace(/<(script|style|nav|footer|aside|form|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<!--([\s\S]*?)-->/g, " ")
        .replace(/<(br|\/p|\/li|\/pre|\/blockquote|\/section)>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function extractReferenceSections(
  source: ReferenceManifestEntry,
  raw: string,
): ReferenceSection[] {
  if (source.expectedContentType === "rfc" || source.expectedContentType === "text") {
    const text = normalizeReferenceText(raw);
    const sections = text.split(/\n(?=\d+(?:\.\d+)*\.?\s+[A-Z])/g);
    return sections
      .map((content) => {
        const [first = "Overview"] = content.split("\n", 1);
        return { heading: first.slice(0, 200), sectionPath: [first.slice(0, 160)], content };
      })
      .filter((section) => section.content.length > 40);
  }
  const body =
    raw.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    raw.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    raw;
  const parts = body.split(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi);
  const sections: ReferenceSection[] = [];
  const path: string[] = [];
  if (parts[0]) {
    const content = stripMarkup(parts[0]);
    if (content.length > 40)
      sections.push({ heading: "Overview", sectionPath: ["Overview"], content });
  }
  for (let index = 1; index < parts.length; index += 3) {
    const level = Number(parts[index] ?? 2);
    const heading = stripMarkup(parts[index + 1] ?? "").slice(0, 200) || "Section";
    const content = stripMarkup(parts[index + 2] ?? "");
    path.splice(Math.max(0, level - 1));
    path[level - 1] = heading;
    if (content.length > 40)
      sections.push({ heading, sectionPath: path.filter(Boolean).slice(0, 8), content });
  }
  return sections;
}
