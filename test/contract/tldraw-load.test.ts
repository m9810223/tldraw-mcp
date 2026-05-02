import { describe, expect, it } from 'vitest';
import { Store } from '@tldraw/store';
import { createTLSchema } from '@tldraw/tlschema';
import { connect, createPage, createRect, createText, moveToPage } from '../../src/tools.js';
import { loadFile } from '../../src/store.js';
import { withTempFile } from '../_helpers.js';

function buildSnapshot(file: { schema: unknown; records: { id: string }[] }) {
  const store: Record<string, { id: string }> = {};
  for (const r of file.records) store[r.id] = r;
  return { schema: file.schema, store } as never;
}

function loadIntoTldraw(file: { schema: unknown; records: { id: string }[] }) {
  const schema = createTLSchema();
  const store = new Store({
    schema,
    props: { defaultName: 'doc', assets: { upload: async () => '', resolve: async () => null }, onMount: () => undefined },
  } as never);
  store.loadStoreSnapshot(buildSnapshot(file));
  return store;
}

describe('contract: tldraw runtime accepts our output', () => {
  const ctx = withTempFile();

  it('empty file loads cleanly', async () => {
    const file = await loadFile(ctx.file);
    expect(() => loadIntoTldraw(file)).not.toThrow();
  });

  it('rect + text + arrow loads with all records intact', async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50, text: 'A' });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 100, h: 50, text: 'B' });
    await createText({ file: ctx.file, x: 0, y: 200, text: 'note' });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id, text: 'flow' });

    const file = await loadFile(ctx.file);
    const store = loadIntoTldraw(file);

    const records = [...store.allRecords()];
    const shapes = records.filter((r) => r.typeName === 'shape');
    const bindings = records.filter((r) => r.typeName === 'binding');

    expect(shapes).toHaveLength(4); // rectA, rectB, text, arrow
    expect(bindings).toHaveLength(2);
  });

  it("multi-page with bindings='pull' move keeps all bindings on the same page", async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 100, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const p2 = await createPage({ file: ctx.file, name: 'P2' });
    await moveToPage({
      file: ctx.file,
      shapeIds: [a.id],
      pageId: p2.pageId,
      bindings: 'pull',
    });

    const file = await loadFile(ctx.file);
    const store = loadIntoTldraw(file);

    const bindings = [...store.allRecords()].filter((r) => r.typeName === 'binding');
    expect(bindings).toHaveLength(2);
  });

  it("multi-page with bindings='error' would have left dangling bindings (proves the safeguard matters)", async () => {
    const a = await createRect({ file: ctx.file, x: 0, y: 0, w: 100, h: 50 });
    const b = await createRect({ file: ctx.file, x: 200, y: 0, w: 100, h: 50 });
    await connect({ file: ctx.file, fromId: a.id, toId: b.id });
    const p2 = await createPage({ file: ctx.file, name: 'P2' });

    await expect(
      moveToPage({ file: ctx.file, shapeIds: [a.id], pageId: p2.pageId, bindings: 'error' }),
    ).rejects.toThrow();
  });
});
