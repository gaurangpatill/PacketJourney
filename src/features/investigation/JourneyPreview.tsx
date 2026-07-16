import { ArrowRight } from "lucide-react";
import type { Investigation } from "./schema";
import { StageIcon } from "./StageIcon";

type JourneyPreviewProps = {
  investigation: Investigation;
  selectedStageId?: string;
  onSelectStage?: (id: string) => void;
  compact?: boolean;
};

export function JourneyPreview({
  investigation,
  selectedStageId,
  onSelectStage,
  compact = false,
}: JourneyPreviewProps) {
  return (
    <div className={`journey-preview${compact ? " journey-preview--compact" : ""}`}>
      <div className="journey-preview__grid" role="list" aria-label="Request journey stages">
        {investigation.stages.map((stage, index) => (
          <div className="journey-preview__step" role="listitem" key={stage.id}>
            <button
              className={`journey-node journey-node--${stage.status}${selectedStageId === stage.id ? " journey-node--selected" : ""}`}
              type="button"
              aria-pressed={selectedStageId === stage.id}
              onClick={() => onSelectStage?.(stage.id)}
              style={{ "--branch": stage.branch } as React.CSSProperties}
            >
              <span className="journey-node__icon">
                <StageIcon type={stage.type} size={compact ? 15 : 18} />
              </span>
              <span className="journey-node__body">
                <strong>{stage.shortTitle}</strong>
                {!compact && stage.durationMs !== undefined ? (
                  <small>{stage.durationMs} ms</small>
                ) : null}
              </span>
              <i className="journey-node__status" aria-label={stage.status} />
            </button>
            {index < investigation.stages.length - 1 ? (
              <span className="journey-connector" aria-hidden="true">
                <i />
                <ArrowRight size={13} />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="journey-preview__caption">
        <span className={`status-dot status-dot--${investigation.status}`} />
        {investigation.mock ? "Recorded demo evidence" : "Live evidence"} ·{" "}
        {investigation.stages.length} stages ·{" "}
        {(investigation.metrics.totalDurationMs / 1000).toFixed(2)} s total
      </p>
    </div>
  );
}
