import type { ReferenceCategory, ReferencePublisher } from "../../features/references/schema";

export interface RetrievalEvaluationCase {
  id: string;
  question: string;
  expectedCategory: ReferenceCategory;
  preferredPublishers: ReferencePublisher[];
  requiredConcepts: string[];
  forbiddenClaims: string[];
}

export const retrievalEvaluationCases: RetrievalEvaluationCase[] = [
  {
    id: "cache-private-no-store",
    question: "What do Cache-Control private and no-store mean for a shared cache?",
    expectedCategory: "caching",
    preferredPublishers: ["ietf"],
    requiredConcepts: ["private", "no-store"],
    forbiddenClaims: ["this site is personalized"],
  },
  {
    id: "cloudflare-cache-status",
    question: "How should CF-Cache-Status DYNAMIC be interpreted?",
    expectedCategory: "cdn",
    preferredPublishers: ["cloudflare"],
    requiredConcepts: ["dynamic"],
    forbiddenClaims: ["origin is misconfigured"],
  },
  {
    id: "cname-complexity",
    question: "What does a long CNAME chain imply operationally?",
    expectedCategory: "dns",
    preferredPublishers: ["ietf"],
    requiredConcepts: ["alias"],
    forbiddenClaims: ["adds exactly"],
  },
  {
    id: "dnssec-ad",
    question: "What are the limitations of the DNSSEC AD signal?",
    expectedCategory: "dnssec",
    preferredPublishers: ["ietf"],
    requiredConcepts: ["resolver"],
    forbiddenClaims: ["completely secure"],
  },
  {
    id: "ct-provenance",
    question:
      "Can an independently inspected certificate prove the exact TLS certificate used by Worker fetch?",
    expectedCategory: "certificates",
    preferredPublishers: ["ietf", "cloudflare"],
    requiredConcepts: ["certificate"],
    forbiddenClaims: ["proves the exact"],
  },
  {
    id: "hostname-mismatch",
    question: "How does certificate hostname mismatch and wildcard SAN matching work?",
    expectedCategory: "certificates",
    preferredPublishers: ["ietf", "cab-forum"],
    requiredConcepts: ["wildcard"],
    forbiddenClaims: ["issuer is unsafe"],
  },
  {
    id: "redirects",
    question: "Explain HTTP 307 and 308 redirect method semantics.",
    expectedCategory: "redirects",
    preferredPublishers: ["ietf"],
    requiredConcepts: ["method"],
    forbiddenClaims: ["always faster"],
  },
  {
    id: "security-headers",
    question: "Are missing browser security headers proof of a vulnerability?",
    expectedCategory: "security-headers",
    preferredPublishers: ["owasp", "mdn"],
    requiredConcepts: ["hardening"],
    forbiddenClaims: ["absence proves"],
  },
  {
    id: "render-blocking",
    question: "How can a stylesheet be a render-blocking candidate?",
    expectedCategory: "performance",
    preferredPublishers: ["web-dev", "mdn"],
    requiredConcepts: ["render"],
    forbiddenClaims: ["caused this page"],
  },
  {
    id: "javascript-transfer",
    question: "How should high JavaScript transfer be investigated?",
    expectedCategory: "performance",
    preferredPublishers: ["web-dev", "mdn"],
    requiredConcepts: ["script"],
    forbiddenClaims: ["root cause"],
  },
  {
    id: "third-party",
    question: "What can third-party dependency loading do to performance?",
    expectedCategory: "third-party-resources",
    preferredPublishers: ["web-dev"],
    requiredConcepts: ["third-party"],
    forbiddenClaims: ["always slow"],
  },
  {
    id: "worker-tls-metadata",
    question: "Which TLS handshake metadata is unavailable from Worker fetch?",
    expectedCategory: "cloudflare-workers-runtime",
    preferredPublishers: ["cloudflare"],
    requiredConcepts: ["tls"],
    forbiddenClaims: ["cipher was"],
  },
  {
    id: "browser-run-lab",
    question: "What are Browser Run laboratory metric limitations?",
    expectedCategory: "cloudflare-browser-run",
    preferredPublishers: ["cloudflare"],
    requiredConcepts: ["laboratory"],
    forbiddenClaims: ["all users"],
  },
  {
    id: "d1-limits",
    question: "What limits should a D1 persistence ledger respect?",
    expectedCategory: "cloudflare-d1",
    preferredPublishers: ["cloudflare"],
    requiredConcepts: ["limits"],
    forbiddenClaims: ["unlimited"],
  },
  {
    id: "r2-private",
    question: "How can R2 browser artifacts remain private?",
    expectedCategory: "cloudflare-r2",
    preferredPublishers: ["cloudflare"],
    requiredConcepts: ["private"],
    forbiddenClaims: ["public bucket required"],
  },
];
