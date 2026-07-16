import {
  AlertTriangle,
  Box,
  Braces,
  Database,
  ExternalLink,
  Globe2,
  HardDrive,
  LockKeyhole,
  Monitor,
  Network,
  Route,
  Server,
} from "lucide-react";
import type { JourneyStage } from "./schema";

const iconByType = {
  input: Monitor,
  dns: Network,
  tls: LockKeyhole,
  redirect: Route,
  edge: Globe2,
  cache: Database,
  origin: Server,
  browser: Braces,
  resource: Box,
  "third-party": ExternalLink,
  error: AlertTriangle,
} satisfies Record<JourneyStage["type"], typeof HardDrive>;

export function StageIcon({ type, size = 18 }: { type: JourneyStage["type"]; size?: number }) {
  const Icon = iconByType[type];
  return <Icon size={size} aria-hidden="true" />;
}
