import { describe, expect, it } from 'vitest';
import {
  alignSchema,
  autoLayoutSchema,
  createGroupSchema,
  createPageSchema,
  createRectSchema,
  distributeSchema,
  fitToTextSchema,
  moveToPageSchema,
} from '../../src/tools.js';

const id = (i: number) => `shape:fake-${i}`;
const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i));

describe('zod array length boundaries (N-1 / N / N+1)', () => {
  describe.each([
    { name: 'distribute', schema: distributeSchema, min: 3, base: { file: '/x', axis: 'horizontal' } },
    { name: 'auto_layout', schema: autoLayoutSchema, min: 2, base: { file: '/x', direction: 'horizontal' } },
    { name: 'align', schema: alignSchema, min: 2, base: { file: '/x', axis: 'left' } },
    { name: 'create_group', schema: createGroupSchema, min: 1, base: { file: '/x' }, key: 'childIds' },
    { name: 'move_to_page', schema: moveToPageSchema, min: 1, base: { file: '/x', pageId: 'page:p' }, key: 'shapeIds' },
  ])('$name (min $min)', ({ schema, min, base, key }) => {
    const idsKey = key ?? 'ids';

    it(`rejects N-1 = ${min - 1}`, () => {
      expect(() => schema.parse({ ...base, [idsKey]: ids(min - 1) })).toThrow();
    });

    it(`accepts N = ${min}`, () => {
      expect(() => schema.parse({ ...base, [idsKey]: ids(min) })).not.toThrow();
    });

    it(`accepts N+1 = ${min + 1}`, () => {
      expect(() => schema.parse({ ...base, [idsKey]: ids(min + 1) })).not.toThrow();
    });
  });
});

describe('zod numeric / string boundaries', () => {
  it.each([
    { w: -1, h: 50, label: 'negative w' },
    { w: 0, h: 50, label: 'zero w (exclusiveMinimum)' },
    { w: 50, h: -1, label: 'negative h' },
    { w: 50, h: 0, label: 'zero h (exclusiveMinimum)' },
  ])('create_rect rejects $label', ({ w, h }) => {
    expect(() => createRectSchema.parse({ file: '/x', x: 0, y: 0, w, h })).toThrow();
  });

  it.each([
    { w: 0.0001, h: 0.0001, label: 'tiny but positive' },
    { w: 1, h: 1, label: 'just above zero' },
    { w: Number.MAX_SAFE_INTEGER, h: 1, label: 'huge w' },
  ])('create_rect accepts $label', ({ w, h }) => {
    expect(() => createRectSchema.parse({ file: '/x', x: 0, y: 0, w, h })).not.toThrow();
  });

  it('create_page rejects empty name', () => {
    expect(() => createPageSchema.parse({ file: '/x', name: '' })).toThrow();
  });

  it('create_page accepts single-character name', () => {
    expect(() => createPageSchema.parse({ file: '/x', name: 'A' })).not.toThrow();
  });

  it('fit_to_text rejects negative padding', () => {
    expect(() => fitToTextSchema.parse({ file: '/x', id: 'shape:1', padding: -1 })).toThrow();
  });

  it.each([0, 1])('fit_to_text accepts non-negative padding (%i)', (p) => {
    expect(() => fitToTextSchema.parse({ file: '/x', id: 'shape:1', padding: p })).not.toThrow();
  });
});
