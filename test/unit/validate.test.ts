import { describe, expect, it } from 'vitest';
import { validateBinding, validateShape } from '../../src/validate.js';
import { makeArrowBinding, makeGeoShape, makeTextShape } from '../../src/shapes.js';

describe('validateShape', () => {
  it('accepts a fully-formed geo rect', () => {
    const shape = makeGeoShape({
      id: 'shape:s1',
      index: 'a1' as never,
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
    expect(() => validateShape(shape)).not.toThrow();
  });

  it('rejects a geo missing required prop scale', () => {
    const shape = makeGeoShape({
      id: 'shape:s1',
      index: 'a1' as never,
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
    delete (shape.props as Record<string, unknown>).scale;
    expect(() => validateShape(shape)).toThrow(/scale/);
  });

  it('rejects a text shape with plain string instead of richText', () => {
    const shape = makeTextShape({
      id: 'shape:t',
      index: 'a1' as never,
      x: 0,
      y: 0,
      text: 'hi',
    });
    (shape.props as Record<string, unknown>).richText = 'hi';
    expect(() => validateShape(shape)).toThrow();
  });

  it('throws on unknown shape type', () => {
    expect(() =>
      validateShape({
        typeName: 'shape',
        id: 'shape:x',
        type: 'doesnotexist',
        props: {},
      } as never),
    ).toThrow(/Unknown shape type|Shape validation failed/);
  });

  it('ignores non-shape records (no throw)', () => {
    expect(() => validateShape({ typeName: 'page', id: 'page:p', name: 'p' } as never)).not.toThrow();
  });
});

describe('validateBinding', () => {
  it('accepts a fully-formed arrow binding', () => {
    const b = makeArrowBinding({
      id: 'binding:b',
      arrowId: 'shape:a',
      shapeId: 'shape:s',
      terminal: 'start',
    });
    expect(() => validateBinding(b)).not.toThrow();
  });

  it('rejects a binding missing snap', () => {
    const b = makeArrowBinding({
      id: 'binding:b',
      arrowId: 'shape:a',
      shapeId: 'shape:s',
      terminal: 'start',
    });
    delete (b.props as Record<string, unknown>).snap;
    expect(() => validateBinding(b)).toThrow(/snap/);
  });
});
