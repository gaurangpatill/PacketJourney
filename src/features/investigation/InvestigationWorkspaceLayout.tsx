import {
  Bot,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";

export type WorkspaceTab = "evidence" | "journey" | "assistant";

type ResizeState = {
  pointerId: number;
  startX: number;
  startWidth: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function PanelResizer({
  side,
  value,
  minimum,
  maximum,
  onChange,
}: {
  side: "left" | "right";
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  const resizeRef = useRef<ResizeState | undefined>(undefined);

  return (
    <div
      className={`workspace-resizer workspace-resizer--${side}`}
      role="separator"
      aria-label={`Resize ${side === "left" ? "evidence inspector" : "evidence assistant"}`}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 12;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        onChange(clamp(value + direction * step * (side === "left" ? 1 : -1), minimum, maximum));
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        resizeRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: value,
        };
      }}
      onPointerMove={(event) => {
        const resize = resizeRef.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        const delta = event.clientX - resize.startX;
        onChange(clamp(resize.startWidth + delta * (side === "left" ? 1 : -1), minimum, maximum));
      }}
      onPointerUp={(event) => {
        if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = undefined;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => {
        resizeRef.current = undefined;
      }}
    >
      <i />
    </div>
  );
}

export function InvestigationWorkspaceLayout({
  evidence,
  journey,
  assistant,
  mobileTab,
  onMobileTabChange,
}: {
  evidence: React.ReactNode;
  journey: React.ReactNode;
  assistant: React.ReactNode;
  mobileTab: WorkspaceTab;
  onMobileTabChange: (tab: WorkspaceTab) => void;
}) {
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(420);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <>
      <div className="workspace-mobile-tabs" role="tablist" aria-label="Investigation workspace">
        {(
          [
            ["journey", "Journey", GitBranch],
            ["evidence", "Evidence", ShieldCheck],
            ["assistant", "Assistant", Bot],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            type="button"
            role="tab"
            id={`workspace-tab-${value}`}
            aria-controls={`workspace-panel-${value}`}
            aria-selected={mobileTab === value}
            tabIndex={mobileTab === value ? 0 : -1}
            onClick={() => onMobileTabChange(value)}
            key={value}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <section
        className="workspace-grid investigation-workspace-layout section-shell"
        aria-label="Investigation journey workspace"
        data-left-collapsed={leftCollapsed}
        data-right-collapsed={rightCollapsed}
        style={
          {
            "--workspace-left-width": `${leftCollapsed ? 46 : leftWidth}px`,
            "--workspace-right-width": `${rightCollapsed ? 46 : rightWidth}px`,
          } as React.CSSProperties
        }
      >
        <div
          id="workspace-panel-evidence"
          className={`workspace-panel workspace-panel--evidence${leftCollapsed ? " is-collapsed" : ""}${mobileTab === "evidence" ? " is-mobile-active" : ""}`}
          role="tabpanel"
          aria-labelledby="workspace-tab-evidence"
        >
          <div className="workspace-panel__content">{evidence}</div>
          <button
            type="button"
            className="workspace-panel__collapse workspace-panel__collapse--left"
            aria-label={leftCollapsed ? "Expand evidence inspector" : "Collapse evidence inspector"}
            aria-expanded={!leftCollapsed}
            onClick={() => setLeftCollapsed((current) => !current)}
          >
            {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {leftCollapsed ? <span>Evidence</span> : null}
          </button>
        </div>

        <PanelResizer
          side="left"
          value={leftWidth}
          minimum={280}
          maximum={480}
          onChange={setLeftWidth}
        />

        <div
          id="workspace-panel-journey"
          className={`workspace-panel workspace-panel--journey${mobileTab === "journey" ? " is-mobile-active" : ""}`}
          role="tabpanel"
          aria-labelledby="workspace-tab-journey"
        >
          {journey}
        </div>

        <PanelResizer
          side="right"
          value={rightWidth}
          minimum={340}
          maximum={620}
          onChange={setRightWidth}
        />

        <div
          id="workspace-panel-assistant"
          className={`workspace-panel workspace-panel--assistant${rightCollapsed ? " is-collapsed" : ""}${mobileTab === "assistant" ? " is-mobile-active" : ""}`}
          role="tabpanel"
          aria-labelledby="workspace-tab-assistant"
        >
          <div className="workspace-panel__content">{assistant}</div>
          <button
            type="button"
            className="workspace-panel__collapse workspace-panel__collapse--right"
            aria-label={
              rightCollapsed ? "Expand evidence assistant" : "Collapse evidence assistant"
            }
            aria-expanded={!rightCollapsed}
            onClick={() => setRightCollapsed((current) => !current)}
          >
            {rightCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            {rightCollapsed ? <span>Assistant</span> : null}
          </button>
        </div>
      </section>
    </>
  );
}
