import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { investigationById } from "../../data/investigations";
import { buildInvestigationGraph } from "./graph";
import { JourneyCanvas } from "./JourneyCanvas";
import { layoutInvestigationGraph } from "./layout";
import { useJourneyController } from "./useJourneyController";

const investigation = investigationById.get("fast-cached")!;
const graph = buildInvestigationGraph(investigation);
const layout = layoutInvestigationGraph(graph);
const allVisible = new Set(graph.nodes.map((node) => node.id));

function renderCanvas(overrides: Partial<React.ComponentProps<typeof JourneyCanvas>> = {}) {
  const props: React.ComponentProps<typeof JourneyCanvas> = {
    graph,
    layout,
    expertise: "developer",
    visibleNodeIds: allVisible,
    playing: false,
    reducedMotion: false,
    onSelectNode: vi.fn(),
    onSelectEdge: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
  return { ...render(<JourneyCanvas {...props} />), props };
}

describe("JourneyCanvas", () => {
  it("selects nodes and edges", async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();
    const onSelectEdge = vi.fn();
    renderCanvas({ onSelectNode, onSelectEdge });

    await user.click(screen.getByRole("button", { name: /Cache.*success stage/i }));
    expect(onSelectNode).toHaveBeenCalledWith("cache");

    await user.click(screen.getAllByRole("button", { name: /Request path:/i })[0]!);
    expect(onSelectEdge).toHaveBeenCalledWith("input::dns");
  });

  it("supports arrow-key navigation and Escape", async () => {
    const user = userEvent.setup();
    const onClearSelection = vi.fn();
    renderCanvas({ onClearSelection });
    const browser = screen.getByRole("button", { name: /^Browser request.*success stage/i });
    const dns = screen.getByRole("button", { name: /^DNS resolution.*success stage/i });
    browser.focus();
    await user.keyboard("{ArrowRight}");
    expect(dns).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("does not animate edges for reduced-motion users", () => {
    const { container } = renderCanvas({ playing: true, reducedMotion: true });
    expect(container.querySelectorAll(".graph-edge.is-playing")).toHaveLength(0);
  });

  it("supports explicit zoom and view controls", async () => {
    const user = userEvent.setup();
    renderCanvas();
    const zoom = screen.getByRole("status", { name: "Zoom level" });
    const initial = zoom.textContent;
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom.textContent).not.toBe(initial);
    await user.click(screen.getByRole("button", { name: "Fit journey to view" }));
    await user.click(screen.getByRole("button", { name: "Reset graph view" }));
    expect(zoom).toHaveTextContent("100%");
  });

  it("renders a safe empty state", () => {
    const emptyGraph = buildInvestigationGraph({
      stages: [],
      findings: [],
      metrics: { totalDurationMs: 0 },
    });
    renderCanvas({
      graph: emptyGraph,
      layout: layoutInvestigationGraph(emptyGraph),
      visibleNodeIds: new Set(),
    });
    expect(screen.getByRole("status")).toHaveTextContent("No journey stages");
  });
});

describe("useJourneyController", () => {
  it("synchronizes scrubbing and node selection", () => {
    const { result } = renderHook(() => useJourneyController(graph, false));
    act(() => result.current.scrubTo(3));
    expect(result.current.selectedNodeId).toBe(graph.nodes[3]!.id);
    expect(result.current.revealedIndex).toBe(3);
    expect(result.current.visibleNodeIds.size).toBe(4);

    act(() => result.current.selectNode("cache"));
    expect(result.current.selectedNodeId).toBe("cache");
    expect(result.current.selectedEdgeId).toBeUndefined();
  });

  it("reveals playback immediately when reduced motion is active", () => {
    const { result } = renderHook(() => useJourneyController(graph, true));
    act(() => result.current.restart());
    expect(result.current.revealedIndex).toBe(0);
    act(() => result.current.play());
    expect(result.current.revealedIndex).toBe(graph.nodes.length - 1);
    expect(result.current.selectedNodeId).toBe(graph.nodes.at(-1)?.id);
    expect(result.current.playing).toBe(false);
  });

  it("progresses normal playback one stage at a time", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useJourneyController(graph, false));
    act(() => result.current.restart());
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(720);
    });
    expect(result.current.revealedIndex).toBe(1);
    expect(result.current.selectedNodeId).toBe(graph.nodes[1]?.id);
    act(() => result.current.pause());
    vi.useRealTimers();
  });
});
