import type { IndexKey } from '@tldraw/utils';
import type { TLRecord } from './store.js';

const DEFAULT_PAGE_ID = 'page:page';

function richText(text: string) {
  if (!text) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

type CommonProps = {
  id: string;
  index: IndexKey;
  x: number;
  y: number;
  parentId?: string;
  rotation?: number;
  opacity?: number;
};

const baseShape = (p: CommonProps) => ({
  typeName: 'shape',
  id: p.id,
  parentId: p.parentId ?? DEFAULT_PAGE_ID,
  index: p.index,
  isLocked: false,
  rotation: p.rotation ?? 0,
  opacity: p.opacity ?? 1,
  x: p.x,
  y: p.y,
  meta: {},
});

export function makeGeoShape(args: CommonProps & {
  geo?: 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'oval' | 'star' | 'rhombus';
  w: number;
  h: number;
  color?: string;
  fill?: 'none' | 'solid' | 'semi' | 'pattern';
  text?: string;
  size?: 's' | 'm' | 'l' | 'xl';
}): TLRecord {
  return {
    ...baseShape(args),
    type: 'geo',
    props: {
      geo: args.geo ?? 'rectangle',
      w: args.w,
      h: args.h,
      color: args.color ?? 'black',
      labelColor: 'black',
      fill: args.fill ?? 'none',
      dash: 'draw',
      size: args.size ?? 'm',
      font: 'draw',
      richText: richText(args.text ?? ''),
      align: 'middle',
      verticalAlign: 'middle',
      growY: 0,
      url: '',
      scale: 1,
    },
  };
}

export function makeTextShape(args: CommonProps & {
  text: string;
  size?: 's' | 'm' | 'l' | 'xl';
  color?: string;
  w?: number;
}): TLRecord {
  return {
    ...baseShape(args),
    type: 'text',
    props: {
      richText: richText(args.text),
      color: args.color ?? 'black',
      size: args.size ?? 'm',
      font: 'draw',
      textAlign: 'start',
      w: args.w ?? 200,
      autoSize: args.w === undefined,
      scale: 1,
    },
  };
}

export function makeArrowShape(args: CommonProps & {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color?: string;
  text?: string;
}): TLRecord {
  return {
    ...baseShape(args),
    type: 'arrow',
    props: {
      kind: 'arc',
      dash: 'draw',
      size: 'm',
      fill: 'none',
      color: args.color ?? 'black',
      labelColor: 'black',
      bend: 0,
      start: { x: args.fromX, y: args.fromY },
      end: { x: args.toX, y: args.toY },
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
      text: args.text ?? '',
      labelPosition: 0.5,
      font: 'draw',
      scale: 1,
      elbowMidPoint: 0.5,
    },
  };
}

export function makeArrowBinding(args: {
  id: string;
  arrowId: string;
  shapeId: string;
  terminal: 'start' | 'end';
}): TLRecord {
  return {
    typeName: 'binding',
    id: args.id,
    type: 'arrow',
    fromId: args.arrowId,
    toId: args.shapeId,
    props: {
      terminal: args.terminal,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: 'none',
    },
    meta: {},
  };
}

export function makeGroupShape(args: {
  id: string;
  index: IndexKey;
  parentId?: string;
}): TLRecord {
  return {
    ...baseShape({ id: args.id, index: args.index, x: 0, y: 0, parentId: args.parentId }),
    type: 'group',
    props: {},
  };
}
