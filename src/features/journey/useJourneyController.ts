import { useCallback, useEffect, useMemo, useState } from "react";
import type { InvestigationGraph } from "./graph";

export type JourneyController = ReturnType<typeof useJourneyController>;

export function useJourneyController(graph: InvestigationGraph, reducedMotion: boolean) {
  const lastIndex = Math.max(0, graph.nodes.length - 1);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [revealedIndex, setRevealedIndex] = useState(lastIndex);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setRevealedIndex(Math.max(0, graph.nodes.length - 1));
    setPlaying(false);
  }, [graph]);

  useEffect(() => {
    if (!playing) return;
    if (reducedMotion) {
      setRevealedIndex(lastIndex);
      setSelectedNodeId(graph.nodes[lastIndex]?.id);
      setPlaying(false);
      return;
    }
    const timer = window.setInterval(() => {
      setRevealedIndex((current) => {
        if (current >= lastIndex) {
          setPlaying(false);
          return current;
        }
        const next = current + 1;
        setSelectedNodeId(graph.nodes[next]?.id);
        setSelectedEdgeId(undefined);
        return next;
      });
    }, 720);
    return () => window.clearInterval(timer);
  }, [graph.nodes, lastIndex, playing, reducedMotion]);

  const selectNode = useCallback((id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(undefined);
  }, []);

  const selectEdge = useCallback((id: string) => {
    setSelectedEdgeId(id);
    setSelectedNodeId(undefined);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
  }, []);

  const scrubTo = useCallback(
    (index: number) => {
      const next = Math.min(lastIndex, Math.max(0, index));
      setPlaying(false);
      setRevealedIndex(next);
      setSelectedNodeId(graph.nodes[next]?.id);
      setSelectedEdgeId(undefined);
    },
    [graph.nodes, lastIndex],
  );

  const play = useCallback(() => {
    if (!graph.nodes.length) return;
    if (reducedMotion) {
      setRevealedIndex(lastIndex);
      setSelectedNodeId(graph.nodes[lastIndex]?.id);
      setSelectedEdgeId(undefined);
      return;
    }
    setRevealedIndex((current) => (current >= lastIndex ? 0 : current));
    setSelectedNodeId((current) => (revealedIndex >= lastIndex ? graph.nodes[0]?.id : current));
    setSelectedEdgeId(undefined);
    setPlaying(true);
  }, [graph.nodes, lastIndex, reducedMotion, revealedIndex]);

  const pause = useCallback(() => setPlaying(false), []);
  const restart = useCallback(() => {
    setPlaying(false);
    setRevealedIndex(0);
    setSelectedNodeId(graph.nodes[0]?.id);
    setSelectedEdgeId(undefined);
  }, [graph.nodes]);

  const visibleNodeIds = useMemo(
    () => new Set(graph.nodes.slice(0, revealedIndex + 1).map((node) => node.id)),
    [graph.nodes, revealedIndex],
  );

  return {
    selectedNodeId,
    selectedEdgeId,
    revealedIndex,
    playing,
    visibleNodeIds,
    selectNode,
    selectEdge,
    clearSelection,
    scrubTo,
    play,
    pause,
    restart,
  };
}
