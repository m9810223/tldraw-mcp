import dagre from '@dagrejs/dagre';
import type { TLRecord, TldrFile } from './store.js';
import { bindingsForShape, findShape, shapesOf } from './store.js';
import { extractText, measureText } from './text-metrics.js';

export type GraphNode = { id: string; w: number; h: number };
export type GraphEdge = {
  arrowId: string;
  fromId: string;
  toId: string;
  label: string;
  labelW: number;
  labelH: number;
};

export function collectGraph(file: TldrFile, ids?: string[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const idSet = ids
    ? new Set(ids)
    : new Set(
        shapesOf(file)
          .filter((s) => {
            const t = s.type as string;
            return t !== 'arrow';
          })
          .map((s) => s.id as string),
      );

  const nodes: GraphNode[] = [];
  for (const id of idSet) {
    const shape = findShape(file, id);
    if (!shape) continue;
    const props = shape.props as { w?: number; h?: number } | undefined;
    if (typeof props?.w !== 'number' || typeof props?.h !== 'number') continue;
    nodes.push({ id, w: props.w, h: props.h });
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const b of bindingsForShape(file, node.id)) {
      const arrowId = b.fromId as string;
      if (seen.has(arrowId)) continue;
      const peer = bindingsForShape(file, arrowId).find((p) => p.toId !== node.id && p.fromId === arrowId);
      if (!peer) continue;
      const peerShapeId = peer.toId as string;
      if (!idSet.has(peerShapeId)) continue;

      const startBinding =
        (b.props as { terminal?: string }).terminal === 'start' ? b : peer;
      const endBinding = startBinding === b ? peer : b;
      const fromId = startBinding.toId as string;
      const toId = endBinding.toId as string;

      const arrowShape = findShape(file, arrowId);
      const text = arrowShape ? extractText(arrowShape) : '';
      const measure = text ? measureText({ text, size: 'm', padding: 0 }) : { w: 0, h: 0 };

      edges.push({
        arrowId,
        fromId,
        toId,
        label: text,
        labelW: measure.w,
        labelH: measure.h,
      });
      seen.add(arrowId);
    }
  }

  return { nodes, edges };
}

export function runDagre(args: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  direction: 'LR' | 'TB' | 'RL' | 'BT';
  nodeGap: number;
  rankGap: number;
  labelPadding: number;
}): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: args.direction,
    nodesep: args.nodeGap,
    ranksep: args.rankGap,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of args.nodes) g.setNode(n.id, { width: n.w, height: n.h });
  for (const e of args.edges) {
    g.setEdge(
      e.fromId,
      e.toId,
      {
        width: e.labelW + args.labelPadding,
        height: e.labelH + args.labelPadding,
        labelpos: 'c',
      },
      e.arrowId,
    );
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of g.nodes()) {
    const n = g.node(id);
    positions.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2 });
  }
  return positions;
}
