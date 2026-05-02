import { describe, expect, it } from 'vitest';
import {
  appendRecord,
  bindingsForShape,
  firstPageId,
  newId,
  nextIndex,
  pageOfShape,
  type TldrFile,
} from '../../src/store.js';
import { emptyTldrFile } from '../../src/template.js';

function file(): TldrFile {
  return emptyTldrFile();
}

describe('store helpers', () => {
  it('newId produces prefixed nanoids of the right length', () => {
    const id = newId('shape');
    expect(id).toMatch(/^shape:[A-Za-z0-9_-]{21}$/);
  });

  it('firstPageId returns the default page from a fresh file', () => {
    expect(firstPageId(file())).toBe('page:page');
  });

  it('nextIndex returns a fractional index above existing shapes', () => {
    const f = file();
    const idx1 = nextIndex(f);
    expect(idx1).toMatch(/^a/);
    const f2 = appendRecord(f, {
      typeName: 'shape',
      id: 'shape:x',
      parentId: 'page:page',
      index: idx1,
      type: 'geo',
      x: 0,
      y: 0,
      meta: {},
      props: {},
      isLocked: false,
      rotation: 0,
      opacity: 1,
    });
    const idx2 = nextIndex(f2);
    expect(idx2 > idx1).toBe(true);
  });

  it('pageOfShape walks parent chain to a page', () => {
    let f = file();
    f = appendRecord(f, {
      typeName: 'shape',
      id: 'shape:group',
      parentId: 'page:page',
      index: 'a1',
      type: 'group',
      x: 0,
      y: 0,
      meta: {},
      props: {},
      isLocked: false,
      rotation: 0,
      opacity: 1,
    });
    f = appendRecord(f, {
      typeName: 'shape',
      id: 'shape:child',
      parentId: 'shape:group',
      index: 'a1',
      type: 'geo',
      x: 0,
      y: 0,
      meta: {},
      props: {},
      isLocked: false,
      rotation: 0,
      opacity: 1,
    });
    expect(pageOfShape(f, 'shape:child')).toBe('page:page');
  });

  it('pageOfShape returns undefined for an unknown shape', () => {
    expect(pageOfShape(file(), 'shape:does-not-exist')).toBeUndefined();
  });

  it('bindingsForShape finds bindings on either terminal', () => {
    let f = file();
    f = appendRecord(f, {
      typeName: 'binding',
      id: 'binding:b1',
      type: 'arrow',
      fromId: 'shape:arrow1',
      toId: 'shape:rectA',
      props: { terminal: 'start' },
      meta: {},
    });
    f = appendRecord(f, {
      typeName: 'binding',
      id: 'binding:b2',
      type: 'arrow',
      fromId: 'shape:arrow1',
      toId: 'shape:rectB',
      props: { terminal: 'end' },
      meta: {},
    });
    expect(bindingsForShape(f, 'shape:rectA').map((b) => b.id)).toEqual(['binding:b1']);
    expect(bindingsForShape(f, 'shape:arrow1').map((b) => b.id)).toEqual(['binding:b1', 'binding:b2']);
    expect(bindingsForShape(f, 'shape:nope')).toEqual([]);
  });
});
