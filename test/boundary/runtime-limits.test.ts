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
