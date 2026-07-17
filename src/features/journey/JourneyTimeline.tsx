import { Pause, Play, RotateCcw } from "lucide-react";
import type { InvestigationGraph } from "./graph";
import type { JourneyController } from "./useJourneyController";

type JourneyTimelineProps = {
  graph: InvestigationGraph;
  controller: JourneyController;
  onStageSelect?: (stageId: string, index: number) => void;
};

export function JourneyTimeline({ graph, controller, onStageSelect }: JourneyTimelineProps) {
  const max = Math.max(0, graph.nodes.length - 1);

  return (
    <div className="journey-timeline" aria-label="Journey timeline">
      <div className="journey-timeline__transport">
        <button
          type="button"
          onClick={controller.playing ? controller.pause : controller.play}
          aria-label={controller.playing ? "Pause journey" : "Play journey"}
        >
          {controller.playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" onClick={controller.restart} aria-label="Restart journey">
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="journey-timeline__scrubber">
        <input
          aria-label="Reveal journey stages"
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(max, controller.revealedIndex)}
          onChange={(event) => {
            const index = Number(event.target.value);
            controller.scrubTo(index);
            const stageId = graph.nodes[index]?.id;
            if (stageId) onStageSelect?.(stageId, index);
          }}
          style={
            {
              "--timeline-progress": `${max ? (controller.revealedIndex / max) * 100 : 100}%`,
            } as React.CSSProperties
          }
        />
        <div className="journey-timeline__ticks" aria-hidden="true">
          {graph.nodes.map((node, index) => (
            <i
              className={index <= controller.revealedIndex ? "is-revealed" : undefined}
              key={node.id}
            />
          ))}
        </div>
      </div>
      <div className="journey-timeline__stages" role="list" aria-label="Skip to stage">
        {graph.nodes.map((node, index) => (
          <button
            type="button"
            role="listitem"
            className={controller.selectedNodeId === node.id ? "is-active" : undefined}
            onClick={() => {
              controller.scrubTo(index);
              onStageSelect?.(node.id, index);
            }}
            aria-label={`Go to ${node.stage.title}`}
            key={node.id}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {node.stage.shortTitle}
          </button>
        ))}
      </div>
      <output className="journey-timeline__position" aria-live="polite">
        {String(Math.min(controller.revealedIndex + 1, graph.nodes.length)).padStart(2, "0")} /{" "}
        {String(graph.nodes.length).padStart(2, "0")}
      </output>
    </div>
  );
}
