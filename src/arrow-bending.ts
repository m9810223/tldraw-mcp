import type { TLRecord, TldrFile } from './store.js';
import { bindingsOf, shapesOf } from './store.js';

export type ArrowEndpoints = { arrowId: string; fromId: string; toId: string };

export function getArrowEndpoints(file: TldrFile): ArrowEndpoints[] {
  const arrows = shapesOf(file).filter((s) => s.type === 'arrow');
  const allBindings = bindingsOf(file);
  const result: ArrowEndpoints[] = [];
  for (const arrow of arrows) {
    const bindings = allBindings.filter((b) => b.fromId === arrow.id);
    const start = bindings.find((b) => (b.props as { terminal?: string }).terminal === 'start');
    const end = bindings.find((b) => (b.props as { terminal?: string }).terminal === 'end');
    if (!start || !end) continue;
    result.push({
      arrowId: arrow.id as string,
      fromId: start.toId as string,
      toId: end.toId as string,
    });
  }
  return result;
}

export function groupOverlappingArrows(endpoints: ArrowEndpoints[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const e of endpoints) {
    const key = [e.fromId, e.toId].sort().join('|');
    const arr = groups.get(key) ?? [];
    arr.push(e.arrowId);
    groups.set(key, arr);
  }
  return [...groups.values()].filter((ids) => ids.length >= 2);
}

export function bendValuesFor(count: number, amount: number): number[] {
  if (count <= 1) return Array(count).fill(0);
  const step = (2 * amount) / (count - 1);
  return Array.from({ length: count }, (_, i) => -amount + step * i);
}

export function sortByPriority(ids: string[], priority?: string[]): string[] {
  if (!priority || priority.length === 0) return [...ids];
  const rank = new Map(priority.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => {
    const ra = rank.get(a) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b) ?? Number.POSITIVE_INFINITY;
    return ra - rb;
  });
}
