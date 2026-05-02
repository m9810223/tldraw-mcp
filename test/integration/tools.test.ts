import { describe, expect, it } from 'vitest';
import {
  align,
  autoLayout,
  bendOverlappingArrows,
  connect,
  createGroup,
  createPage,
  createRect,
  createText,
  deleteShape,
  distribute,
  execJq,
  fitToText,
  getShape,
  graphLayout,
  listPages,
  listShapes,
  measureArrowLabels,
  moveToPage,
  searchApi,
  ungroup,
  updateShape,
} from '../../src/tools.js';
import { loadFile } from '../../src/store.js';
import { withTempFile } from '../_helpers.js';

describe('tools integration', () => {
  const ctx = withTempFile();

  it('create_rect adds a geo shape with Hello label', async () => {
    const { id } = await createRect({ file: ctx.file, x: 10, y: 20, w: 100, h: 50, text: 'Hello' });
    const shape = await getShape({ file: ctx.file, id });
    expect(shape.type).toBe('geo');
    expect(shape.x).toBe(10);
    expect((shape.props as { richText: { content: { content: { text: string }[] }[] } }).richText.content[0].content[0].text).toBe('Hello');
  });

  it('list_shapes filters by type', async () => {
    await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    await createText({ file: ctx.file, x: 100, y: 0, text: 'label' });
    expect((await listShapes({ file: ctx.file })).count).toBe(2);
    expect((await listShapes({ file: ctx.file, type: 'text' })).count).toBe(1);
  });

  it('connect creates arrow + 2 bindings', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const result = await connect({ file: ctx.file, fromId: a.id, toId: b.id, text: 'flow' });
    expect(result.bindings).toHaveLength(2);

    const f = await loadFile(ctx.file);
    const bindings = f.records.filter((r) => r.typeName === 'binding');
    expect(bindings).toHaveLength(2);
    const terminals = bindings.map((b) => (b.props as { terminal: string }).terminal).sort();
    expect(terminals).toEqual(['end', 'start']);
  });

  it('connect refuses cross-page shapes', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const p2 = await createPage({ file: ctx.file, name: 'P2' });
    await moveToPage({ file: ctx.file, shapeIds: [b.id], pageId: p2.pageId, bindings: 'error' });
    await expect(connect({ file: ctx.file, fromId: a.id, toId: b.id })).rejects.toThrow(/Cross-page/);
  });

  it('delete_shape with cascade removes related bindings and orphan arrow', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });

    const result = await deleteShape({ file: ctx.file, id: a.id, cascade: true });
    expect(result.removed.length).toBeGreaterThanOrEqual(3); // shape + 2 bindings + arrow

    const f = await loadFile(ctx.file);
    expect(f.records.filter((r) => r.typeName === 'binding')).toHaveLength(0);
    expect(f.records.filter((r) => r.typeName === 'shape' && r.type === 'arrow')).toHaveLength(0);
    expect(f.records.filter((r) => r.typeName === 'shape')).toHaveLength(1);
  });

  it('delete_shape without cascade leaves orphan bindings', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });

    await deleteShape({ file: ctx.file, id: a.id, cascade: false });

    const f = await loadFile(ctx.file);
    expect(f.records.filter((r) => r.typeName === 'binding')).toHaveLength(2);
  });

  it('update_shape merges nested props', async () => {
    const { id } = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    await updateShape({ file: ctx.file, id, patch: { x: 99, props: { color: 'blue' } } });

    const shape = await getShape({ file: ctx.file, id });
    expect(shape.x).toBe(99);
    expect((shape.props as { color: string }).color).toBe('blue');
    expect((shape.props as { w: number }).w).toBe(50);
  });

  it('group + ungroup round-trip preserves children', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 100, y: 0, w: 50, h: 50 });
    const { groupId } = await createGroup({ file: ctx.file, childIds: [a.id, b.id] });

    let f = await loadFile(ctx.file);
    expect(f.records.find((r) => r.id === a.id)?.parentId).toBe(groupId);

    await ungroup({ file: ctx.file, groupId });

    f = await loadFile(ctx.file);
    expect(f.records.find((r) => r.id === a.id)?.parentId).toBe('page:page');
    expect(f.records.find((r) => r.id === groupId)).toBeUndefined();
  });

  it('move_to_page bindings=error refuses when peer not moved', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const p2 = await createPage({ file: ctx.file, name: 'P2' });

    await expect(
      moveToPage({ file: ctx.file, shapeIds: [a.id], pageId: p2.pageId, bindings: 'error' }),
    ).rejects.toThrow(/binding to/);
  });

  it("move_to_page bindings='pull' drags peer + arrow along", async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const p2 = await createPage({ file: ctx.file, name: 'P2' });

    const result = await moveToPage({
      file: ctx.file,
      shapeIds: [a.id],
      pageId: p2.pageId,
      bindings: 'pull',
    });
    expect(result.moved.length).toBe(3); // a + b + arrow

    const f = await loadFile(ctx.file);
    const onP2 = f.records.filter((r) => r.typeName === 'shape' && r.parentId === p2.pageId);
    expect(onP2).toHaveLength(3);
  });

  it("move_to_page bindings='cut' drops dangling bindings", async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const p2 = await createPage({ file: ctx.file, name: 'P2' });

    const result = await moveToPage({
      file: ctx.file,
      shapeIds: [a.id],
      pageId: p2.pageId,
      bindings: 'cut',
    });
    expect(result.cutBindings?.length).toBeGreaterThan(0);

    const f = await loadFile(ctx.file);
    const aRecord = f.records.find((r) => r.id === a.id);
    expect(aRecord?.parentId).toBe(p2.pageId);
  });

  it('list_pages reflects newly created page', async () => {
    await createPage({ file: ctx.file, name: 'Second' });
    const { pages } = await listPages({ file: ctx.file });
    expect(pages.map((p) => p.name)).toEqual(['Page 1', 'Second']);
  });

  it('search_api returns curated list with stillSupported flags', async () => {
    const result = await searchApi({ verbose: false });
    expect(result.tldrawSchemaVersion).toBe(2);
    expect(result.shapeTypes?.find((s) => s.type === 'geo')?.stillSupported).toBe(true);
  });

  it('search_api verbose returns live prop names', async () => {
    const result = await searchApi({ type: 'geo', verbose: true });
    expect(result.props).toContain('richText');
    expect(result.props).toContain('scale');
  });

  it('exec_jq dry run does not modify the file', async () => {
    await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const before = await loadFile(ctx.file);
    await execJq({ file: ctx.file, filter: '.records | length', write: false });
    const after = await loadFile(ctx.file);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('create_rect autoFit sizes the rect to its text', async () => {
    const tiny = await createRect({
      file: ctx.file,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      text: 'short',
      autoFit: true,
    });
    const long = await createRect({
      file: ctx.file,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      text: 'a much longer label that needs more room',
      autoFit: true,
    });
    expect(long.w).toBeGreaterThan(tiny.w);
  });

  it('fit_to_text resizes an existing geo to fit overflowing text', async () => {
    const { id } = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50, text: 'tiny' });
    await updateShape({
      file: ctx.file,
      id,
      patch: { props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'much longer label here' }] }] } } },
    });

    const result = await fitToText({ file: ctx.file, id, padding: 16 });
    expect(result.w).toBeGreaterThan(100);

    const shape = await getShape({ file: ctx.file, id });
    expect((shape.props as { w: number }).w).toBe(result.w);
  });

  it('fit_to_text wraps when maxWidth is given', async () => {
    const { id } = await createRect({
      file: ctx.file,
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      text: 'one two three four five six seven eight nine ten',
    });
    const wide = await fitToText({ file: ctx.file, id });
    const narrow = await fitToText({ file: ctx.file, id, maxWidth: 120 });
    expect(narrow.h).toBeGreaterThan(wide.h);
    expect(narrow.lines).toBeGreaterThan(wide.lines);
  });

  it('fit_to_text on arrow returns measurement with advisory (no mutation)', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const arrow = await connect({ file: ctx.file, fromId: a.id, toId: b.id, text: 'flows to' });

    const result = await fitToText({ file: ctx.file, id: arrow.arrowId });
    expect(result.w).toBeGreaterThan(0);
    expect(result.advisory).toMatch(/auto_layout/);

    const arrowShape = await getShape({ file: ctx.file, id: arrow.arrowId });
    expect((arrowShape.props as { text: string }).text).toBe('flows to');
  });

  it('fit_to_text rejects shapes with no text capability', async () => {
    const { id } = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    await updateShape({
      file: ctx.file,
      id,
      patch: {
        // pretend it's a frame for testing the rejection — easier: just test on group
      },
    });
    const { groupId } = await createGroup({ file: ctx.file, childIds: [id] });
    await expect(fitToText({ file: ctx.file, id: groupId })).rejects.toThrow(/only supports/);
  });

  it('align left puts every shape at the leftmost x', async () => {
    const a = await createRect({ file: ctx.file, x: 50, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 100, w: 100, h: 50 });
    const c = await createRect({ file: ctx.file, x: 30, y: 200, w: 100, h: 50 });
    await align({ file: ctx.file, ids: [a.id, b.id, c.id], axis: 'left' });
    for (const id of [a.id, b.id, c.id]) {
      const s = await getShape({ file: ctx.file, id });
      expect(s.x).toBe(30);
    }
  });

  it('align center-y centers shapes vertically against shared midline', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 100 });
    const b = await createRect({ file: ctx.file, x: 200, y: 200, w: 100, h: 100 });
    await align({ file: ctx.file, ids: [a.id, b.id], axis: 'center-y' });
    const sa = await getShape({ file: ctx.file, id: a.id });
    const sb = await getShape({ file: ctx.file, id: b.id });
    const ca = (sa.y as number) + ((sa.props as { h: number }).h) / 2;
    const cb = (sb.y as number) + ((sb.props as { h: number }).h) / 2;
    expect(ca).toBe(cb);
  });

  it('distribute horizontal evens out gaps between shapes', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 130, y: 0, w: 100, h: 50 });
    const c = await createRect({ file: ctx.file, x: 500, y: 0, w: 100, h: 50 });
    const result = await distribute({ file: ctx.file, ids: [a.id, b.id, c.id], axis: 'horizontal' });
    const middle = result.distributed.find((d) => d.id === b.id)!;
    expect(middle.x).toBeGreaterThan(100);
    expect(middle.x).toBeLessThan(500);
  });

  it('auto_layout horizontal chains shapes with the given gap', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 999, y: 999, w: 80, h: 50 });
    const c = await createRect({ file: ctx.file, x: 50, y: 200, w: 60, h: 50 });
    const r = await autoLayout({
      file: ctx.file,
      ids: [a.id, b.id, c.id],
      direction: 'horizontal',
      gap: 20,
      startX: 0,
      startY: 0,
    });
    expect(r.positions[0]).toMatchObject({ id: a.id, x: 0, y: 0 });
    expect(r.positions[1]).toMatchObject({ id: b.id, x: 120, y: 0 }); // 0 + 100 + 20
    expect(r.positions[2]).toMatchObject({ id: c.id, x: 220, y: 0 }); // 120 + 80 + 20
  });

  it('auto_layout rejects shapes without measurable bounds', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const arrow = await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    await expect(
      autoLayout({ file: ctx.file, ids: [a.id, arrow.arrowId], direction: 'horizontal', gap: 10 }),
    ).rejects.toThrow(/measurable/);
  });

  it('measure_arrow_labels reports label sizes and dx/dy', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 400, y: 0, w: 100, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id, text: 'long enough label here' });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id }); // unlabeled, should be omitted

    const result = await measureArrowLabels({ file: ctx.file });
    expect(result.count).toBe(1);
    expect(result.labels[0].label).toBe('long enough label here');
    expect(result.labels[0].fromId).toBe(a.id);
    expect(result.labels[0].toId).toBe(b.id);
    expect(result.labels[0].w).toBeGreaterThan(0);
    expect(result.labels[0].dx).toBe(400);
    expect(result.labels[0].dy).toBe(0);
    expect(typeof result.labels[0].roomForLabel).toBe('boolean');
  });

  it('graph_layout places branching topology with non-overlapping ranks', async () => {
    const root = await createRect({ file: ctx.file, x: 0, y: 0, w: 120, h: 60, text: 'root' });
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 120, h: 60, text: 'A' });
    const b = await createRect({ file: ctx.file, x: 0, y: 0, w: 120, h: 60, text: 'B' });
    const a1 = await createRect({ file: ctx.file, x: 0, y: 0, w: 120, h: 60, text: 'A1' });
    const a2 = await createRect({ file: ctx.file, x: 0, y: 0, w: 120, h: 60, text: 'A2' });
    await connect({ file: ctx.file, fromId: root.id, toId: a.id });
    await connect({ file: ctx.file, fromId: root.id, toId: b.id });
    await connect({ file: ctx.file, fromId: a.id, toId: a1.id });
    await connect({ file: ctx.file, fromId: a.id, toId: a2.id });

    const result = await graphLayout({
      file: ctx.file,
      direction: 'LR',
      nodeGap: 40,
      rankGap: 100,
      labelPadding: 0,
      startX: 0,
      startY: 0,
    });
    expect(result.nodes).toBe(5);
    expect(result.edges).toBe(4);

    const rootShape = await getShape({ file: ctx.file, id: root.id });
    const aShape = await getShape({ file: ctx.file, id: a.id });
    const a1Shape = await getShape({ file: ctx.file, id: a1.id });
    expect((aShape.x as number)).toBeGreaterThan(rootShape.x as number);
    expect((a1Shape.x as number)).toBeGreaterThan(aShape.x as number);
  });

  it('graph_layout TB places ranks vertically', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });

    await graphLayout({
      file: ctx.file,
      direction: 'TB',
      nodeGap: 40,
      rankGap: 80,
      labelPadding: 0,
      startX: 0,
      startY: 0,
    });

    const aShape = await getShape({ file: ctx.file, id: a.id });
    const bShape = await getShape({ file: ctx.file, id: b.id });
    expect((bShape.y as number)).toBeGreaterThan(aShape.y as number);
  });

  it("auto_layout fitArrowLabels widens gap when an arrow label connects two shapes", async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const c = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    await connect({
      file: ctx.file,
      fromId: a.id,
      toId: b.id,
      text: 'this is a sufficiently long label',
    });

    const baseline = await autoLayout({
      file: ctx.file,
      ids: [a.id, b.id, c.id],
      direction: 'horizontal',
      gap: 20,
      startX: 0,
      startY: 0,
      fitArrowLabels: false,
      labelPadding: 20,
    });
    const widened = await autoLayout({
      file: ctx.file,
      ids: [a.id, b.id, c.id],
      direction: 'horizontal',
      gap: 20,
      startX: 0,
      startY: 0,
      fitArrowLabels: true,
      labelPadding: 20,
    });

    const baselineGapAB = (baseline.positions[1].x as number) - (baseline.positions[0].x as number);
    const widenedGapAB = (widened.positions[1].x as number) - (widened.positions[0].x as number);
    const baselineGapBC = (baseline.positions[2].x as number) - (baseline.positions[1].x as number);
    const widenedGapBC = (widened.positions[2].x as number) - (widened.positions[1].x as number);

    expect(widenedGapAB).toBeGreaterThan(baselineGapAB);
    expect(widenedGapBC).toBe(baselineGapBC); // no arrow B→C, gap unchanged
  });

  it('bend_overlapping_arrows: reverse-direction arrows land on opposite visual sides (same raw bend)', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const ab = await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const ba = await connect({ file: ctx.file, fromId: b.id, toId: a.id });

    const result = await bendOverlappingArrows({ file: ctx.file, amount: 30 });
    expect(result.groups).toBe(1);
    const f = await loadFile(ctx.file);
    const bendOf = (id: string) =>
      (f.records.find((r) => r.id === id)!.props as { bend: number }).bend;
    // tldraw's `bend` is in the arrow's local frame: same raw value on a reversed arrow
    // = opposite visual side, which is what we want for non-overlap.
    expect(bendOf(ab.arrowId)).toBe(bendOf(ba.arrowId));
    expect(Math.abs(bendOf(ab.arrowId))).toBe(30);
  });

  it('bend_overlapping_arrows: same-direction parallel arrows get opposite raw bends', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const ab1 = await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const ab2 = await connect({ file: ctx.file, fromId: a.id, toId: b.id });

    await bendOverlappingArrows({ file: ctx.file, amount: 30 });
    const f = await loadFile(ctx.file);
    const bendOf = (id: string) =>
      (f.records.find((r) => r.id === id)!.props as { bend: number }).bend;
    expect(bendOf(ab1.arrowId)).toBe(-30);
    expect(bendOf(ab2.arrowId)).toBe(30);
  });

  it('bend_overlapping_arrows leaves single-edge arrows untouched', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const c = await createRect({ file: ctx.file, x: 400, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    await connect({ file: ctx.file, fromId: b.id, toId: c.id });

    const result = await bendOverlappingArrows({ file: ctx.file, amount: 30 });
    expect(result.groups).toBe(0);
    expect(result.updated).toEqual([]);
  });

  it('bend_overlapping_arrows honors priority — listed arrow stays straightest', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const ab1 = await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const ab2 = await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const ab3 = await connect({ file: ctx.file, fromId: a.id, toId: b.id });

    await bendOverlappingArrows({
      file: ctx.file,
      amount: 30,
      priority: [ab2.arrowId],
    });
    const f = await loadFile(ctx.file);
    const bendOf = (id: string) =>
      (f.records.find((r) => r.id === id)!.props as { bend: number }).bend;
    // priority sort = [ab2, ab1, ab3]; bends ordered by |bend| ascending = [0, -30, +30]
    // → ab2 (most important) gets 0 (straightest), ab1 gets -30, ab3 gets +30
    expect(bendOf(ab2.arrowId)).toBe(0);
    expect(bendOf(ab1.arrowId)).toBe(-30);
    expect(bendOf(ab3.arrowId)).toBe(30);
  });

  it('graph_layout auto-bends parallel arrows', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const ab1 = await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const ab2 = await connect({ file: ctx.file, fromId: b.id, toId: a.id });

    await graphLayout({
      file: ctx.file,
      direction: 'LR',
      nodeGap: 60,
      rankGap: 120,
      labelPadding: 20,
      startX: 0,
      startY: 0,
    });

    const f = await loadFile(ctx.file);
    const bend1 = (f.records.find((r) => r.id === ab1.arrowId)!.props as { bend: number }).bend;
    const bend2 = (f.records.find((r) => r.id === ab2.arrowId)!.props as { bend: number }).bend;
    // ab1 (A→B) and ab2 (B→A) are reversed in direction → same raw bend = opposite sides
    expect(bend1).toBe(bend2);
    expect(Math.abs(bend1)).toBe(30);
  });
});

import {
  listCheckpointsTool,
  restoreCheckpointTool,
  saveCheckpointTool,
} from '../../src/tools.js';

describe('checkpoints', () => {
  const ctx = withTempFile();

  it('save_checkpoint creates a backup file', async () => {
    await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const { path } = await saveCheckpointTool({ file: ctx.file, label: 'one' });
    expect(path).toMatch(/__one\.bak$/);

    const list = await listCheckpointsTool({ file: ctx.file });
    expect(list.checkpoints).toHaveLength(1);
  });

  it('restore_checkpoint reverts file content', async () => {
    const before = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    await saveCheckpointTool({ file: ctx.file, label: 'snap' });
    await createRect({ file: ctx.file, x: 100, y: 100, w: 50, h: 50 });
    expect((await listShapes({ file: ctx.file })).count).toBe(2);

    await restoreCheckpointTool({ file: ctx.file });
    const result = await listShapes({ file: ctx.file });
    expect(result.count).toBe(1);
    expect(result.shapes[0].id).toBe(before.id);
  });

  it('restore_checkpoint throws when no checkpoints exist', async () => {
    await expect(restoreCheckpointTool({ file: ctx.file })).rejects.toThrow(/No checkpoints/);
  });
});
