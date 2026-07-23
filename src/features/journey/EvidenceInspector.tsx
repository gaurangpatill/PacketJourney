import { AlertTriangle, Check, GitBranch, Info, ShieldCheck } from "lucide-react";
import type { EvidenceItem, ExpertiseMode } from "../investigation/schema";
import { StageIcon } from "../investigation/StageIcon";
import type { GraphEdge, GraphNode, InvestigationGraph } from "./graph";
import { nodeDescription, visibleEvidenceItems } from "./presentation";

function valueText(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value, null, 2);
}

function EvidenceDetail({ item, expertise }: { item: EvidenceItem; expertise: ExpertiseMode }) {
  return (
    <div
      className={`evidence-detail evidence-detail--${item.confidence}`}
      data-evidence-id={item.id}
    >
      <div>
        <span>{item.label}</span>
        <strong>{valueText(item.value)}</strong>
      </div>
      {expertise !== "beginner" ? (
        <p>
          <span>
            {item.confidence === "verified" ? <Check size={10} /> : <Info size={10} />}
            {item.confidence}
          </span>
          <span>{item.source}</span>
        </p>
      ) : null}
      {expertise === "engineer" ? (
        <time dateTime={item.collectedAt}>{new Date(item.collectedAt).toISOString()}</time>
      ) : null}
    </div>
  );
}

function NodeInspector({ node, expertise }: { node: GraphNode; expertise: ExpertiseMode }) {
  const visibleEvidence = visibleEvidenceItems(node.stage.evidence, expertise);
  const verified = visibleEvidence.filter((item) => item.confidence === "verified");
  const inferred = visibleEvidence.filter((item) => item.confidence === "inferred");
  const limitations = node.stage.evidence.filter((item) =>
    /limitation|unavailable|inspection error|diagnostic error/i.test(item.label),
  );
  return (
    <>
      <div className="inspector-summary">
        <span className={`inspector-summary__icon is-${node.stage.status}`}>
          <StageIcon type={node.stage.type} />
        </span>
        <div>
          <p>
            {node.stage.type.replace("-", " ")} · {node.stage.status}
          </p>
          <h3>{node.stage.title}</h3>
          <span>{nodeDescription(node.stage, expertise)}</span>
        </div>
      </div>
      <dl className="inspector-facts">
        <div>
          <dt>Duration</dt>
          <dd>
            {node.stage.durationMs === undefined ? "Unavailable" : `${node.stage.durationMs} ms`}
          </dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{node.path}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{node.stage.evidence.length} items</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{node.confidence}</dd>
        </div>
      </dl>
      {node.isBottleneck ? (
        <div className="inspector-callout inspector-callout--warning">
          <AlertTriangle size={14} />
          <div>
            <strong>Measured bottleneck</strong>
            <span>This stage has the dominant recorded duration.</span>
          </div>
        </div>
      ) : null}
      {verified.length ? (
        <section className="inspector-section">
          <h3>
            <ShieldCheck size={12} /> Verified evidence
          </h3>
          {verified.map((item) => (
            <EvidenceDetail item={item} expertise={expertise} key={item.id} />
          ))}
        </section>
      ) : null}
      {inferred.length ? (
        <section className="inspector-section">
          <h3>
            <Info size={12} /> Inferred evidence
          </h3>
          {inferred.map((item) => (
            <EvidenceDetail item={item} expertise={expertise} key={item.id} />
          ))}
        </section>
      ) : null}
      {node.relatedFindings.length ? (
        <section className="inspector-section">
          <h3>
            <AlertTriangle size={12} /> Related findings
          </h3>
          {node.relatedFindings.map((finding) => (
            <div className="inspector-finding" key={finding.id}>
              <span>{finding.severity}</span>
              <strong>{finding.title}</strong>
              <p>{finding.explanation}</p>
              {finding.recommendation ? <small>{finding.recommendation}</small> : null}
            </div>
          ))}
        </section>
      ) : null}
      {limitations.length ? (
        <section className="inspector-section inspector-limitations">
          <h3>
            <Info size={12} /> Known limitations
          </h3>
          {limitations.map((item) => (
            <p key={item.id}>
              <strong>{item.label}</strong>
              <span>{valueText(item.value)}</span>
            </p>
          ))}
        </section>
      ) : null}
    </>
  );
}

function EdgeInspector({
  edge,
  graph,
  expertise,
}: {
  edge: GraphEdge;
  graph: InvestigationGraph;
  expertise: ExpertiseMode;
}) {
  const source = graph.nodes.find((node) => node.id === edge.sourceId);
  const target = graph.nodes.find((node) => node.id === edge.targetId);
  return (
    <>
      <div className="inspector-summary inspector-summary--edge">
        <span className="inspector-summary__icon">
          <GitBranch size={18} />
        </span>
        <div>
          <p>{edge.relationship} relationship</p>
          <h3>{edge.label}</h3>
          <span>
            {edge.detail ??
              `${source?.stage.title ?? edge.sourceId} to ${target?.stage.title ?? edge.targetId}`}
          </span>
        </div>
      </div>
      <dl className="inspector-facts">
        <div>
          <dt>From</dt>
          <dd>{source?.stage.shortTitle ?? edge.sourceId}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{target?.stage.shortTitle ?? edge.targetId}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{edge.path}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{edge.relationship}</dd>
        </div>
      </dl>
      {edge.evidence.length ? (
        <section className="inspector-section">
          <h3>
            <ShieldCheck size={12} /> Relationship evidence
          </h3>
          {edge.evidence.map((item) => (
            <EvidenceDetail item={item} expertise={expertise} key={item.id} />
          ))}
        </section>
      ) : (
        <div className="inspector-callout">
          <Info size={14} />
          <div>
            <strong>Topology relationship</strong>
            <span>Derived from the validated stage connection.</span>
          </div>
        </div>
      )}
    </>
  );
}

type EvidenceInspectorProps = {
  graph: InvestigationGraph;
  selectedNode?: GraphNode;
  selectedEdge?: GraphEdge;
  expertise: ExpertiseMode;
};

export function EvidenceInspector({
  graph,
  selectedNode,
  selectedEdge,
  expertise,
}: EvidenceInspectorProps) {
  return (
    <aside className="evidence-panel panel" aria-label="Evidence inspector">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">SELECTED EVIDENCE</p>
          <h2>Evidence Inspector</h2>
        </div>
      </div>
      <div className="evidence-panel__content">
        {selectedNode ? <NodeInspector node={selectedNode} expertise={expertise} /> : null}
        {selectedEdge ? (
          <EdgeInspector edge={selectedEdge} graph={graph} expertise={expertise} />
        ) : null}
        {!selectedNode && !selectedEdge ? (
          <div className="inspector-empty">
            <GitBranch size={25} />
            <strong>Nothing selected</strong>
            <p>Select a node or relationship to inspect its evidence.</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
