import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  appendRecord,
  bindingsForShape,
  findShape,
  firstPageId,
  loadFile,
  newId,
  nextIndex,
  pageOfShape,
  removeRecord,
  replaceRecord,
  saveFile,
  shapesOf,
  withFileLock,
  type TLRecord,
  type TldrFile,
} from './store.js';
import { makeArrowBinding, makeArrowShape, makeGeoShape, makeGroupShape, makeTextShape } from './shapes.js';
import { listCheckpoints, restoreCheckpoint, saveCheckpoint } from './checkpoint.js';
import { runJq } from './jq.js';
import { emptyTldrFile } from './template.js';
import { extractText, measureText } from './text-metrics.js';
import { validateBinding, validateShape } from './validate.js';

const FilePath = z.string().describe('Absolute path to a .tldr file');

export const createRectSchema = z.object({
  file: FilePath,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  text: z.string().optional(),
  color: z.string().optional(),
  autoFit: z
    .boolean()
    .default(false)
    .describe('If true and text is set, ignore w/h and size the rect to fit the text (heuristic).'),
  size: z.enum(['s', 'm', 'l', 'xl']).optional(),
});

export async function createRect(args: z.infer<typeof createRectSchema>) {
  return withFileLock(args.file, async () => {
    const file = await loadFile(args.file);
    const id = newId('shape');

    let { w, h } = args;
    if (args.autoFit && args.text) {
      const fit = measureText({ text: args.text, size: args.size });
      w = fit.w;
      h = fit.h;
    }

    const shape = makeGeoShape({
      id,
      parentId: firstPageId(file),
      index: nextIndex(file),
      x: args.x,
      y: args.y,
      w,
      h,
      text: args.text,
      color: args.color,
      size: args.size,
    });
    validateShape(shape);
    await saveFile(args.file, appendRecord(file, shape));
    return { id, w, h };
  });
}

export const createTextSchema = z.object({
  file: FilePath,
  x: z.number(),
  y: z.number(),
  text: z.string(),
  size: z.enum(['s', 'm', 'l', 'xl']).optional(),
  color: z.string().optional(),
});

export async function createText(args: z.infer<typeof createTextSchema>) {
  return withFileLock(args.file, async () => {
    const file = await loadFile(args.file);
    const id = newId('shape');
    const shape = makeTextShape({
      id,
      parentId: firstPageId(file),
      index: nextIndex(file),
      x: args.x,
      y: args.y,
      text: args.text,
      size: args.size,
      color: args.color,
    });
    validateShape(shape);
    await saveFile(args.file, appendRecord(file, shape));
    return { id };
  });
}

export const listShapesSchema = z.object({
  file: FilePath,
  type: z.string().optional().describe('Filter by shape type (geo, text, arrow, ...)'),
});

export async function listShapes(args: z.infer<typeof listShapesSchema>) {
  const file = await loadFile(args.file);
  const shapes = shapesOf(file)
    .filter((s) => !args.type || s.type === args.type)
    .map((s) => ({
      id: s.id as string,
      type: s.type as string,
      x: s.x as number,
      y: s.y as number,
      label: extractLabel(s),
    }));
  return { count: shapes.length, shapes };
}

export const getShapeSchema = z.object({
  file: FilePath,
  id: z.string(),
});

export async function getShape(args: z.infer<typeof getShapeSchema>) {
  const file = await loadFile(args.file);
  const shape = findShape(file, args.id);
  if (!shape) throw new Error(`Shape not found: ${args.id}`);
  return shape;
}

export const updateShapeSchema = z.object({
  file: FilePath,
  id: z.string(),
  patch: z.record(z.unknown()).describe('Partial shape fields to merge (top-level or nested under "props")'),
});

export async function updateShape(args: z.infer<typeof updateShapeSchema>) {
  return withFileLock(args.file, async () => {
    const file = await loadFile(args.file);
    const existing = findShape(file, args.id);
    if (!existing) throw new Error(`Shape not found: ${args.id}`);

    const merged: TLRecord = { ...existing, ...args.patch };
    if ('props' in args.patch && typeof args.patch.props === 'object' && args.patch.props !== null) {
      merged.props = { ...(existing.props as object), ...(args.patch.props as object) };
    }
    validateShape(merged);
    await saveFile(args.file, replaceRecord(file, merged));
    return { ok: true };
  });
}

export const deleteShapeSchema = z.object({
  file: FilePath,
  id: z.string(),
  cascade: z
    .boolean()
    .default(true)
    .describe('Also remove related arrow bindings and arrow shapes that lose all bindings'),
});

export async function deleteShape(args: z.infer<typeof deleteShapeSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    const removed: string[] = [args.id];
    file = removeRecord(file, args.id);

    if (args.cascade) {
      const related = bindingsForShape(file, args.id);
      const affectedArrowIds = new Set(related.map((b) => b.fromId as string));
      for (const b of related) {
        file = removeRecord(file, b.id as string);
        removed.push(b.id as string);
      }
      for (const arrowId of affectedArrowIds) {
        const otherBindings = bindingsForShape(file, arrowId);
        for (const b of otherBindings) {
          file = removeRecord(file, b.id as string);
          removed.push(b.id as string);
        }
        if (findShape(file, arrowId)) {
          file = removeRecord(file, arrowId);
          removed.push(arrowId);
        }
      }
    }

    await saveFile(args.file, file);
    return { ok: true, removed };
  });
}

export const connectSchema = z.object({
  file: FilePath,
  fromId: z.string().describe('Source shape id'),
  toId: z.string().describe('Target shape id'),
  text: z.string().optional(),
});

export async function connect(args: z.infer<typeof connectSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    const from = findShape(file, args.fromId);
    const to = findShape(file, args.toId);
    if (!from) throw new Error(`Source shape not found: ${args.fromId}`);
    if (!to) throw new Error(`Target shape not found: ${args.toId}`);

    const fromPage = pageOfShape(file, args.fromId);
    const toPage = pageOfShape(file, args.toId);
    if (!fromPage || !toPage) {
      throw new Error(`Cannot resolve page for source/target shape (orphan shape?)`);
    }
    if (fromPage !== toPage) {
      throw new Error(
        `Cross-page connect not allowed: ${args.fromId} on ${fromPage}, ${args.toId} on ${toPage}. Move them to the same page first.`,
      );
    }

    const arrowId = newId('shape');
    const arrow = makeArrowShape({
      id: arrowId,
      parentId: fromPage,
      index: nextIndex(file),
      x: 0,
      y: 0,
      fromX: 0,
      fromY: 0,
      toX: 0,
      toY: 0,
      text: args.text,
    });
    validateShape(arrow);
    file = appendRecord(file, arrow);

    const startBinding = makeArrowBinding({
      id: newId('binding'),
      arrowId,
      shapeId: args.fromId,
      terminal: 'start',
    });
    const endBinding = makeArrowBinding({
      id: newId('binding'),
      arrowId,
      shapeId: args.toId,
      terminal: 'end',
    });
    validateBinding(startBinding);
    validateBinding(endBinding);
    file = appendRecord(file, startBinding);
    file = appendRecord(file, endBinding);

    await saveFile(args.file, file);
    return { arrowId, bindings: [startBinding.id, endBinding.id] };
  });
}

export const saveCheckpointSchema = z.object({
  file: FilePath,
  label: z.string().optional().describe('Optional human-readable tag (becomes part of filename)'),
});

export async function saveCheckpointTool(args: z.infer<typeof saveCheckpointSchema>) {
  const path = await saveCheckpoint(args.file, args.label);
  return { path };
}

export const listCheckpointsSchema = z.object({ file: FilePath });

export async function listCheckpointsTool(args: z.infer<typeof listCheckpointsSchema>) {
  return { checkpoints: await listCheckpoints(args.file) };
}

export const createEmptyFileSchema = z.object({
  file: FilePath,
  overwrite: z.boolean().default(false).describe('If false (default), error when file already exists'),
});

export async function createEmptyFile(args: z.infer<typeof createEmptyFileSchema>) {
  const exists = await fs.access(args.file).then(() => true, () => false);
  if (exists && !args.overwrite) {
    throw new Error(`File already exists: ${args.file} (pass overwrite=true to replace)`);
  }
  const file: TldrFile = emptyTldrFile();
  await saveFile(args.file, file);
  return { path: args.file, pageId: firstPageId(file) };
}

export const restoreCheckpointSchema = z.object({
  file: FilePath,
  checkpoint: z.string().optional().describe('Checkpoint path; omit to restore the most recent'),
});

export async function restoreCheckpointTool(args: z.infer<typeof restoreCheckpointSchema>) {
  return withFileLock(args.file, async () => {
    const restored = await restoreCheckpoint(args.file, args.checkpoint);
    return { restoredFrom: restored };
  });
}

const SHAPE_TYPES = {
  geo: {
    description: 'Rectangle/ellipse/triangle/diamond/oval/star/rhombus',
    requiredProps: ['geo', 'w', 'h'],
    helper: 'create_rect (uses geo: rectangle)',
  },
  text: {
    description: 'Text label',
    requiredProps: ['text'],
    helper: 'create_text',
  },
  arrow: {
    description: 'Arrow line, can bind to shapes',
    requiredProps: ['start', 'end'],
    helper: 'connect (creates arrow + bindings between two shapes)',
  },
  draw: { description: 'Freehand drawing', requiredProps: ['segments'], helper: null },
  line: { description: 'Straight/curved line', requiredProps: ['points'], helper: null },
  note: { description: 'Sticky note', requiredProps: ['color', 'text'], helper: null },
  frame: { description: 'Frame (group container)', requiredProps: ['name', 'w', 'h'], helper: null },
  image: { description: 'Image (needs asset)', requiredProps: ['assetId', 'w', 'h'], helper: null },
  video: { description: 'Video (needs asset)', requiredProps: ['assetId', 'w', 'h'], helper: null },
  embed: { description: 'Embedded URL', requiredProps: ['url', 'w', 'h'], helper: null },
  bookmark: { description: 'URL bookmark card', requiredProps: ['url'], helper: null },
  highlight: { description: 'Highlighter stroke', requiredProps: ['segments'], helper: null },
  group: {
    description: 'Logical group container; children reference it via parentId',
    requiredProps: [],
    helper: 'create_group',
  },
} as const;

export const searchApiSchema = z.object({
  query: z.string().optional().describe('Optional substring to filter shape types'),
  type: z.string().optional().describe('When verbose=true, the specific shape type to introspect'),
  verbose: z
    .boolean()
    .default(false)
    .describe('If true, dump the live prop names from @tldraw/tlschema for the given type'),
});

export async function searchApi(args: z.infer<typeof searchApiSchema>) {
  const { defaultShapeSchemas, defaultBindingSchemas } = await import('@tldraw/tlschema');

  if (args.verbose && args.type) {
    const schema = (defaultShapeSchemas as Record<string, { props: Record<string, unknown> }>)[
      args.type
    ];
    if (!schema) {
      return {
        error: `Unknown shape type: ${args.type}`,
        availableTypes: Object.keys(defaultShapeSchemas),
      };
    }
    return {
      type: args.type,
      props: Object.keys(schema.props),
      note: 'These are the prop keys validated by tldraw. Build the record with these in `props`.',
    };
  }

  const q = args.query?.toLowerCase();
  const liveTypes = new Set(Object.keys(defaultShapeSchemas));

  const types = Object.entries(SHAPE_TYPES)
    .filter(([k, v]) => !q || k.includes(q) || v.description.toLowerCase().includes(q))
    .map(([k, v]) => ({
      type: k,
      ...v,
      stillSupported: liveTypes.has(k),
    }));

  const newTypes = [...liveTypes].filter((t) => !(t in SHAPE_TYPES));

  return {
    tldrawSchemaVersion: 2,
    bindingTypes: Object.keys(defaultBindingSchemas),
    shapeTypes: types,
    newTypesNotInCuratedList: newTypes,
    note:
      'For an unsupported / new type, call search_api({ type, verbose: true }) for live prop names, then build the record and inject via exec_jq.',
  };
}

export const execJqSchema = z.object({
  file: FilePath,
  filter: z.string().describe('jq filter expression'),
  write: z
    .boolean()
    .default(false)
    .describe('If true, write the filter result back to the file. If false, return result only.'),
});

export async function execJq(args: z.infer<typeof execJqSchema>) {
  if (!args.write) {
    const input = await fs.readFile(args.file, 'utf-8');
    const { stdout, stderr } = await runJq(args.filter, input);
    return { result: stdout, stderr: stderr || undefined };
  }
  return withFileLock(args.file, async () => {
    const input = await fs.readFile(args.file, 'utf-8');
    const { stdout, stderr } = await runJq(args.filter, input);
    await saveCheckpoint(args.file, 'pre_exec_jq');
    await fs.writeFile(args.file, stdout);
    return { written: true, stderr: stderr || undefined };
  });
}

type ShapeBounds = { id: string; x: number; y: number; w: number; h: number; shape: TLRecord };

function bounds(shape: TLRecord): ShapeBounds | null {
  if (shape.typeName !== 'shape') return null;
  const props = shape.props as { w?: number; h?: number } | undefined;
  if (typeof props?.w !== 'number' || typeof props?.h !== 'number') return null;
  return {
    id: shape.id as string,
    x: shape.x as number,
    y: shape.y as number,
    w: props.w,
    h: props.h,
    shape,
  };
}

function loadBounds(file: TldrFile, ids: string[]): ShapeBounds[] {
  return ids.map((id) => {
    const shape = findShape(file, id);
    if (!shape) throw new Error(`Shape not found: ${id}`);
    const b = bounds(shape);
    if (!b) throw new Error(`Shape ${id} (type=${shape.type}) has no measurable w/h; align/distribute only supports geo/text/note/frame.`);
    return b;
  });
}

export const alignSchema = z.object({
  file: FilePath,
  ids: z.array(z.string()).min(2),
  axis: z.enum(['left', 'right', 'top', 'bottom', 'center-x', 'center-y']),
});

export async function align(args: z.infer<typeof alignSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    const items = loadBounds(file, args.ids);

    let target: number;
    switch (args.axis) {
      case 'left':
        target = Math.min(...items.map((i) => i.x));
        for (const i of items) i.x = target;
        break;
      case 'right':
        target = Math.max(...items.map((i) => i.x + i.w));
        for (const i of items) i.x = target - i.w;
        break;
      case 'top':
        target = Math.min(...items.map((i) => i.y));
        for (const i of items) i.y = target;
        break;
      case 'bottom':
        target = Math.max(...items.map((i) => i.y + i.h));
        for (const i of items) i.y = target - i.h;
        break;
      case 'center-x':
        target = (Math.min(...items.map((i) => i.x)) + Math.max(...items.map((i) => i.x + i.w))) / 2;
        for (const i of items) i.x = target - i.w / 2;
        break;
      case 'center-y':
        target = (Math.min(...items.map((i) => i.y)) + Math.max(...items.map((i) => i.y + i.h))) / 2;
        for (const i of items) i.y = target - i.h / 2;
        break;
    }

    for (const i of items) {
      const updated = { ...i.shape, x: i.x, y: i.y };
      validateShape(updated);
      file = replaceRecord(file, updated);
    }
    await saveFile(args.file, file);
    return { aligned: items.map((i) => ({ id: i.id, x: i.x, y: i.y })) };
  });
}

export const distributeSchema = z.object({
  file: FilePath,
  ids: z.array(z.string()).min(3).describe('Need at least 3 shapes — first and last anchor, middle ones get even gaps'),
  axis: z.enum(['horizontal', 'vertical']),
});

export async function distribute(args: z.infer<typeof distributeSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    const items = loadBounds(file, args.ids);

    if (args.axis === 'horizontal') {
      items.sort((a, b) => a.x - b.x);
      const first = items[0];
      const last = items[items.length - 1];
      const totalSpan = last.x + last.w - first.x;
      const sumWidths = items.reduce((s, i) => s + i.w, 0);
      const gap = (totalSpan - sumWidths) / (items.length - 1);
      let cursor = first.x + first.w + gap;
      for (let i = 1; i < items.length - 1; i++) {
        items[i].x = cursor;
        cursor += items[i].w + gap;
      }
    } else {
      items.sort((a, b) => a.y - b.y);
      const first = items[0];
      const last = items[items.length - 1];
      const totalSpan = last.y + last.h - first.y;
      const sumHeights = items.reduce((s, i) => s + i.h, 0);
      const gap = (totalSpan - sumHeights) / (items.length - 1);
      let cursor = first.y + first.h + gap;
      for (let i = 1; i < items.length - 1; i++) {
        items[i].y = cursor;
        cursor += items[i].h + gap;
      }
    }

    for (const i of items) {
      const updated = { ...i.shape, x: i.x, y: i.y };
      validateShape(updated);
      file = replaceRecord(file, updated);
    }
    await saveFile(args.file, file);
    return { distributed: items.map((i) => ({ id: i.id, x: i.x, y: i.y })) };
  });
}

export const autoLayoutSchema = z.object({
  file: FilePath,
  ids: z.array(z.string()).min(2),
  direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
  gap: z.number().nonnegative().default(40),
  startX: z.number().optional().describe('Defaults to the first shape\'s current x'),
  startY: z.number().optional().describe('Defaults to the first shape\'s current y'),
});

export async function autoLayout(args: z.infer<typeof autoLayoutSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    const items = loadBounds(file, args.ids);

    let x = args.startX ?? items[0].x;
    let y = args.startY ?? items[0].y;
    const positions: { id: string; x: number; y: number }[] = [];

    for (const item of items) {
      item.x = x;
      item.y = y;
      positions.push({ id: item.id, x, y });
      if (args.direction === 'horizontal') x += item.w + args.gap;
      else y += item.h + args.gap;

      const updated = { ...item.shape, x: item.x, y: item.y };
      validateShape(updated);
      file = replaceRecord(file, updated);
    }
    await saveFile(args.file, file);
    return { positions, direction: args.direction, gap: args.gap };
  });
}

export const fitToTextSchema = z.object({
  file: FilePath,
  id: z.string(),
  maxWidth: z.number().positive().optional().describe('Wrap text at this width before measuring; default = no wrap'),
  padding: z.number().nonnegative().default(16),
});

export async function fitToText(args: z.infer<typeof fitToTextSchema>) {
  return withFileLock(args.file, async () => {
    const file = await loadFile(args.file);
    const shape = findShape(file, args.id);
    if (!shape) throw new Error(`Shape not found: ${args.id}`);
    if (shape.type !== 'geo' && shape.type !== 'text') {
      throw new Error(`fit_to_text only supports geo and text shapes (got ${shape.type})`);
    }

    const text = extractText(shape);
    if (!text) return { id: args.id, w: shape.props && (shape.props as { w?: number }).w, h: shape.props && (shape.props as { h?: number }).h, skipped: 'no text' as const };

    const props = shape.props as { size?: 's' | 'm' | 'l' | 'xl'; scale?: number };
    const fit = measureText({
      text,
      size: props.size,
      scale: props.scale,
      maxWidth: args.maxWidth,
      padding: args.padding,
    });

    const updated: TLRecord = {
      ...shape,
      props: { ...(shape.props as object), w: fit.w, ...(shape.type === 'geo' ? { h: fit.h } : {}) },
    };
    validateShape(updated);
    await saveFile(args.file, replaceRecord(file, updated));
    return { id: args.id, w: fit.w, h: fit.h, lines: fit.lines };
  });
}

function extractLabel(shape: TLRecord): string {
  const props = shape.props as Record<string, unknown> | undefined;
  if (!props) return '';
  if (typeof props.text === 'string' && props.text.length > 0) return props.text;
  const rt = props.richText as { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined;
  if (!rt?.content) return '';
  const texts: string[] = [];
  for (const para of rt.content) {
    for (const node of para.content ?? []) {
      if (typeof node.text === 'string') texts.push(node.text);
    }
  }
  return texts.join(' ');
}

export const createGroupSchema = z.object({
  file: FilePath,
  childIds: z.array(z.string()).min(1).describe('Shape ids to reparent into the new group'),
});

export async function createGroup(args: z.infer<typeof createGroupSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    for (const id of args.childIds) {
      if (!findShape(file, id)) throw new Error(`Shape not found: ${id}`);
    }
    const groupId = newId('shape');
    const group = makeGroupShape({
      id: groupId,
      parentId: firstPageId(file),
      index: nextIndex(file),
    });
    validateShape(group);
    file = appendRecord(file, group);

    for (const childId of args.childIds) {
      const child = findShape(file, childId);
      if (!child) continue;
      const reparented = { ...child, parentId: groupId };
      validateShape(reparented);
      file = replaceRecord(file, reparented);
    }
    await saveFile(args.file, file);
    return { groupId, childCount: args.childIds.length };
  });
}

export const ungroupSchema = z.object({
  file: FilePath,
  groupId: z.string().describe('Group shape id to dissolve'),
});

export async function ungroup(args: z.infer<typeof ungroupSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    const group = findShape(file, args.groupId);
    if (!group) throw new Error(`Group not found: ${args.groupId}`);
    if (group.type !== 'group') throw new Error(`Shape is not a group: ${args.groupId} (type=${group.type})`);

    const groupParentId = group.parentId as string;
    const children = shapesOf(file).filter((s) => s.parentId === args.groupId);

    for (const child of children) {
      const reparented = { ...child, parentId: groupParentId };
      validateShape(reparented);
      file = replaceRecord(file, reparented);
    }
    file = removeRecord(file, args.groupId);
    await saveFile(args.file, file);
    return { reparented: children.map((c) => c.id as string) };
  });
}

export const createPageSchema = z.object({
  file: FilePath,
  name: z.string().min(1).describe('Display name for the page'),
});

export async function createPage(args: z.infer<typeof createPageSchema>) {
  return withFileLock(args.file, async () => {
    const file = await loadFile(args.file);
    const pages = file.records.filter((r) => r.typeName === 'page');
    const pageId = `page:${(await import('nanoid')).nanoid(21)}`;

    const sortedIndices = pages.map((p) => p.index as string).sort();
    const lastIndex = sortedIndices[sortedIndices.length - 1] ?? 'a0';
    const { getIndexAbove } = await import('@tldraw/utils');
    const index = getIndexAbove(lastIndex as never);

    const newPage: TLRecord = {
      typeName: 'page',
      id: pageId,
      name: args.name,
      index,
      meta: {},
    };
    await saveFile(args.file, appendRecord(file, newPage));
    return { pageId };
  });
}

export const listPagesSchema = z.object({ file: FilePath });

export async function listPages(args: z.infer<typeof listPagesSchema>) {
  const file = await loadFile(args.file);
  const pages = file.records
    .filter((r) => r.typeName === 'page')
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      index: p.index as string,
    }))
    .sort((a, b) => a.index.localeCompare(b.index));
  return { pages };
}

export const moveToPageSchema = z.object({
  file: FilePath,
  shapeIds: z.array(z.string()).min(1),
  pageId: z.string().describe('Target page id'),
  bindings: z
    .enum(['error', 'pull', 'cut'])
    .default('error')
    .describe(
      "How to handle bindings whose other end isn't being moved: 'error' refuses the move, 'pull' drags the connected shapes along, 'cut' deletes the bindings (and orphan arrows).",
    ),
});

export async function moveToPage(args: z.infer<typeof moveToPageSchema>) {
  return withFileLock(args.file, async () => {
    let file = await loadFile(args.file);
    const targetPage = file.records.find((r) => r.typeName === 'page' && r.id === args.pageId);
    if (!targetPage) throw new Error(`Page not found: ${args.pageId}`);

    const moveSet = new Set(args.shapeIds);

    if (args.bindings === 'pull') {
      let grew = true;
      while (grew) {
        grew = false;
        for (const shapeId of [...moveSet]) {
          for (const b of bindingsForShape(file, shapeId)) {
            const arrowId = b.fromId as string;
            const otherShapeId = b.toId as string;
            if (!moveSet.has(arrowId)) {
              moveSet.add(arrowId);
              grew = true;
            }
            if (!moveSet.has(otherShapeId) && otherShapeId !== shapeId) {
              moveSet.add(otherShapeId);
              grew = true;
            }
          }
        }
      }
    }

    if (args.bindings === 'error') {
      for (const id of moveSet) {
        for (const b of bindingsForShape(file, id)) {
          const peer = b.fromId === id ? (b.toId as string) : (b.fromId as string);
          if (!moveSet.has(peer)) {
            throw new Error(
              `Shape ${id} has a binding to ${peer} which is not being moved. Use bindings='pull' to drag connected shapes along, or bindings='cut' to delete the bindings.`,
            );
          }
        }
      }
    }

    const cutBindingIds: string[] = [];
    if (args.bindings === 'cut') {
      const orphanArrows = new Set<string>();
      for (const id of moveSet) {
        for (const b of bindingsForShape(file, id)) {
          const peer = b.fromId === id ? (b.toId as string) : (b.fromId as string);
          if (!moveSet.has(peer)) {
            file = removeRecord(file, b.id as string);
            cutBindingIds.push(b.id as string);
            orphanArrows.add(b.fromId as string);
          }
        }
      }
      for (const arrowId of orphanArrows) {
        if (bindingsForShape(file, arrowId).length === 0 && findShape(file, arrowId)) {
          file = removeRecord(file, arrowId);
        }
      }
    }

    for (const id of moveSet) {
      const shape = findShape(file, id);
      if (!shape) continue;
      const reparented = { ...shape, parentId: args.pageId };
      validateShape(reparented);
      file = replaceRecord(file, reparented);
    }

    await saveFile(args.file, file);
    return {
      moved: [...moveSet],
      cutBindings: cutBindingIds.length > 0 ? cutBindingIds : undefined,
    };
  });
}
