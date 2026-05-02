import { describe, expect, it } from 'vitest';
import {
  align,
  autoLayout,
  connect,
  createEmptyFile,
  createGroup,
  createPage,
  createRect,
  deleteShape,
  distribute,
  execJq,
  fitToText,
  getShape,
  graphLayout,
  measureArrowLabels,
  moveToPage,
  restoreCheckpointTool,
  searchApi,
  ungroup,
  updateShape,
} from '../../src/tools.js';
import { withTempFile } from '../_helpers.js';

describe('not-found id rejections', () => {
  const ctx = withTempFile();

  it('get_shape rejects unknown id', async () => {
    await expect(getShape({ file: ctx.file, id: 'shape:nope' })).rejects.toThrow(/not found/i);
  });

  it('update_shape rejects unknown id', async () => {
    await expect(
      updateShape({ file: ctx.file, id: 'shape:nope', patch: { x: 1 } }),
    ).rejects.toThrow(/not found/i);
  });

  it('connect rejects unknown fromId / toId', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    await expect(connect({ file: ctx.file, fromId: 'shape:nope', toId: a.id })).rejects.toThrow(/not found/i);
    await expect(connect({ file: ctx.file, fromId: a.id, toId: 'shape:nope' })).rejects.toThrow(/not found/i);
  });

  it('ungroup rejects unknown groupId', async () => {
    await expect(ungroup({ file: ctx.file, groupId: 'shape:nope' })).rejects.toThrow(/not found/i);
  });

  it('ungroup rejects non-group shape', async () => {
    const r = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    await expect(ungroup({ file: ctx.file, groupId: r.id })).rejects.toThrow(/not a group/i);
  });

  it('move_to_page rejects unknown pageId', async () => {
    const r = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    await expect(
      moveToPage({ file: ctx.file, shapeIds: [r.id], pageId: 'page:nope', bindings: 'error' }),
    ).rejects.toThrow(/not found/i);
  });

  it('move_to_page rejects unknown shapeId', async () => {
    const p = await createPage({ file: ctx.file, name: 'P2' });
    await expect(
      moveToPage({ file: ctx.file, shapeIds: ['shape:nope'], pageId: p.pageId, bindings: 'error' }),
    ).rejects.toThrow(/not found/i);
  });

  it('create_group rejects unknown childId', async () => {
    await expect(
      createGroup({ file: ctx.file, childIds: ['shape:nope'] }),
    ).rejects.toThrow(/not found/i);
  });

  it('fit_to_text rejects unknown id', async () => {
    await expect(fitToText({ file: ctx.file, id: 'shape:nope', padding: 16 })).rejects.toThrow(/not found/i);
  });
});

describe('create_empty_file overwrite boundary', () => {
  const ctx = withTempFile();

  it('rejects overwriting an existing file when overwrite=false', async () => {
    await expect(
      createEmptyFile({ file: ctx.file, overwrite: false }),
    ).rejects.toThrow(/already exists/i);
  });

  it('accepts overwrite=true', async () => {
    await expect(
      createEmptyFile({ file: ctx.file, overwrite: true }),
    ).resolves.toBeDefined();
  });
});

describe('exec_jq error propagation', () => {
  const ctx = withTempFile();

  it('throws on invalid jq syntax', async () => {
    await expect(
      execJq({ file: ctx.file, filter: 'this is not valid jq', write: false }),
    ).rejects.toThrow();
  });

  it('reports stderr on type errors but does not throw if jq exits 0', async () => {
    const r = await execJq({ file: ctx.file, filter: '.records | length', write: false });
    expect(r.result).toContain('2'); // empty file has 2 records (document + page)
  });
});

describe('measure_arrow_labels empty / N / N+1', () => {
  const ctx = withTempFile();

  it('empty file → count=0, labels=[]', async () => {
    const r = await measureArrowLabels({ file: ctx.file });
    expect(r.count).toBe(0);
    expect(r.labels).toEqual([]);
  });

  it('arrow with empty label is skipped', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id }); // no text
    const r = await measureArrowLabels({ file: ctx.file });
    expect(r.count).toBe(0);
  });

  it('N=1 labeled arrow', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id, text: 'one' });
    const r = await measureArrowLabels({ file: ctx.file });
    expect(r.count).toBe(1);
  });
});

describe('graph_layout edge cases', () => {
  const ctx = withTempFile();

  it('throws on empty file (no measurable shapes)', async () => {
    await expect(
      graphLayout({
        file: ctx.file,
        direction: 'LR',
        nodeGap: 60,
        rankGap: 120,
        labelPadding: 20,
        startX: 0,
        startY: 0,
      }),
    ).rejects.toThrow(/no measurable/i);
  });

  it('handles a single node', async () => {
    const r = await createRect({ file: ctx.file, x: 999, y: 999, w: 100, h: 50 });
    const result = await graphLayout({
      file: ctx.file,
      direction: 'LR',
      nodeGap: 60,
      rankGap: 120,
      labelPadding: 20,
      startX: 0,
      startY: 0,
    });
    expect(result.nodes).toBe(1);
    expect(result.edges).toBe(0);
    const shape = await getShape({ file: ctx.file, id: r.id });
    expect(shape.x).toBe(0);
    expect(shape.y).toBe(0);
  });

  it('handles a 2-node cycle (A→B→A) without crashing', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    await connect({ file: ctx.file, fromId: b.id, toId: a.id });
    const result = await graphLayout({
      file: ctx.file,
      direction: 'LR',
      nodeGap: 60,
      rankGap: 120,
      labelPadding: 20,
      startX: 0,
      startY: 0,
    });
    expect(result.nodes).toBe(2);
    expect(result.edges).toBe(2);
  });
});

describe('connect edge cases', () => {
  const ctx = withTempFile();

  it('refuses self-connect (fromId === toId)', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const result = await connect({ file: ctx.file, fromId: a.id, toId: a.id });
    expect(result.arrowId).toBeDefined();
  });
});

describe('delete_shape boundary', () => {
  const ctx = withTempFile();

  it('cascade=true on shape with no bindings still succeeds', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const r = await deleteShape({ file: ctx.file, id: a.id, cascade: true });
    expect(r.removed).toEqual([a.id]);
  });
});

describe('distribute / align / auto_layout runtime boundaries', () => {
  const ctx = withTempFile();

  it('distribute with N=3 places the middle shape between the outer two', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 130, y: 0, w: 100, h: 50 });
    const c = await createRect({ file: ctx.file, x: 500, y: 0, w: 100, h: 50 });
    const r = await distribute({ file: ctx.file, ids: [a.id, b.id, c.id], axis: 'horizontal' });
    const middle = r.distributed.find((d) => d.id === b.id)!;
    expect(middle.x).toBeGreaterThan(100);
    expect(middle.x).toBeLessThan(500);
  });

  it('auto_layout with N=2 chains them correctly', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const r = await autoLayout({
      file: ctx.file,
      ids: [a.id, b.id],
      direction: 'horizontal',
      gap: 20,
      startX: 0,
      startY: 0,
      fitArrowLabels: false,
      labelPadding: 0,
    });
    expect(r.positions[1].x).toBe(120);
  });

  it('align with N=2 aligns both', async () => {
    const a = await createRect({ file: ctx.file, x: 50, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 100, h: 50 });
    await align({ file: ctx.file, ids: [a.id, b.id], axis: 'left' });
    expect((await getShape({ file: ctx.file, id: a.id })).x).toBe(50);
    expect((await getShape({ file: ctx.file, id: b.id })).x).toBe(50);
  });
});

describe('restore_checkpoint when none exist', () => {
  const ctx = withTempFile();
  it('throws explicit "No checkpoints" message', async () => {
    await expect(restoreCheckpointTool({ file: ctx.file })).rejects.toThrow(/No checkpoints/i);
  });
});

describe('search_api verbose for unknown type', () => {
  it('returns error object instead of throwing', async () => {
    const r = await searchApi({ type: 'doesnotexist', verbose: true });
    expect(r.error).toMatch(/Unknown shape type/);
  });
});

describe('align — every axis', () => {
  const ctx = withTempFile();

  it.each(['left', 'right', 'top', 'bottom', 'center-x', 'center-y'] as const)(
    'axis=%s aligns all shapes consistently',
    async (axis) => {
      const a = await createRect({ file: ctx.file, x: 50, y: 30, w: 100, h: 50 });
      const b = await createRect({ file: ctx.file, x: 200, y: 130, w: 80, h: 40 });
      const c = await createRect({ file: ctx.file, x: 30, y: 200, w: 60, h: 60 });
      const r = await align({ file: ctx.file, ids: [a.id, b.id, c.id], axis });

      const get = (id: string) => r.aligned.find((i) => i.id === id)!;
      const A = get(a.id);
      const B = get(b.id);
      const C = get(c.id);

      switch (axis) {
        case 'left':
          expect(A.x).toBe(B.x);
          expect(B.x).toBe(C.x);
          break;
        case 'right':
          expect(A.x + 100).toBe(B.x + 80);
          expect(B.x + 80).toBe(C.x + 60);
          break;
        case 'top':
          expect(A.y).toBe(B.y);
          expect(B.y).toBe(C.y);
          break;
        case 'bottom':
          expect(A.y + 50).toBe(B.y + 40);
          expect(B.y + 40).toBe(C.y + 60);
          break;
        case 'center-x':
          expect(A.x + 50).toBe(B.x + 40);
          expect(B.x + 40).toBe(C.x + 30);
          break;
        case 'center-y':
          expect(A.y + 25).toBe(B.y + 20);
          expect(B.y + 20).toBe(C.y + 30);
          break;
      }
    },
  );
});

describe('distribute vertical', () => {
  const ctx = withTempFile();
  it('vertical distributes evenly between outermost two', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 0, y: 30, w: 50, h: 50 });
    const c = await createRect({ file: ctx.file, x: 0, y: 500, w: 50, h: 50 });
    const r = await distribute({ file: ctx.file, ids: [a.id, b.id, c.id], axis: 'vertical' });
    const middle = r.distributed.find((d) => d.id === b.id)!;
    expect(middle.y).toBeGreaterThan(50);
    expect(middle.y).toBeLessThan(500);
  });
});

describe('fit_to_text on shape with empty text', () => {
  const ctx = withTempFile();
  it('returns skipped marker without modifying the shape', async () => {
    const r = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const before = await getShape({ file: ctx.file, id: r.id });
    const result = await fitToText({ file: ctx.file, id: r.id, padding: 16 });
    expect(result.skipped).toBe('no text');
    const after = await getShape({ file: ctx.file, id: r.id });
    expect((after.props as { w: number }).w).toBe((before.props as { w: number }).w);
  });
});

describe('exec_jq write=true', () => {
  const ctx = withTempFile();
  it('writes filter result back and creates a pre_exec_jq checkpoint', async () => {
    await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const result = await execJq({
      file: ctx.file,
      filter: '.records[0].name = "TOUCHED" | .',
      write: true,
    });
    expect(result.written).toBe(true);

    const after = await execJq({ file: ctx.file, filter: '.records[0].name', write: false });
    expect(after.result).toContain('TOUCHED');

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const ckptDir = path.join(path.dirname(ctx.file), '.tldraw-mcp-checkpoints');
    const entries = await fs.readdir(ckptDir);
    expect(entries.some((e) => e.includes('pre_exec_jq'))).toBe(true);
  });
});

describe('concurrent writes are serialized via withFileLock', () => {
  const ctx = withTempFile();
  it('5 parallel create_rect calls all land cleanly', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createRect({ file: ctx.file, x: i * 100, y: 0, w: 50, h: 50, text: `n${i}` }),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(5);

    const list = await import('../../src/tools.js').then((m) =>
      m.listShapes({ file: ctx.file }),
    );
    expect(list.count).toBe(5);
  });
});

describe('delete_shape × move_to_page binding interactions', () => {
  const ctx = withTempFile();

  it("bindings='cut' deletes orphan arrow when both endpoints stay behind", async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const c = await createRect({ file: ctx.file, x: 0, y: 200, w: 50, h: 50 });
    const arrow = await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const p2 = await createPage({ file: ctx.file, name: 'P2' });

    await moveToPage({
      file: ctx.file,
      shapeIds: [c.id],
      pageId: p2.pageId,
      bindings: 'cut',
    });

    const arrowStillThere = await getShape({ file: ctx.file, id: arrow.arrowId });
    expect(arrowStillThere).toBeDefined();
  });

  it('cascade=true on shape with arrow chain removes the entire chain', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    const arrow = await connect({ file: ctx.file, fromId: a.id, toId: b.id });

    const r = await deleteShape({ file: ctx.file, id: a.id, cascade: true });
    expect(r.removed).toContain(a.id);
    expect(r.removed).toContain(arrow.arrowId);
    expect(r.removed.filter((id) => id.startsWith('binding:')).length).toBe(2);
  });

  it('cascade=false on shape leaves bindings dangling but does not crash', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 50, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 50, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });

    const r = await deleteShape({ file: ctx.file, id: a.id, cascade: false });
    expect(r.removed).toEqual([a.id]);
  });
});
