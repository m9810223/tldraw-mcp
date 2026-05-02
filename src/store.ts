import fs from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { nanoid } from 'nanoid';
import { getIndexAbove, ZERO_INDEX_KEY, type IndexKey } from '@tldraw/utils';

export type TLRecord = Record<string, unknown> & {
  typeName: string;
  id: string;
};

export type TldrFile = {
  tldrawFileFormatVersion: number;
  schema: {
    schemaVersion: number;
    sequences: Record<string, number>;
  };
  records: TLRecord[];
};

const DEFAULT_PAGE_ID = 'page:page';

export function firstPageId(file: TldrFile): string {
  const page = file.records.find((r) => r.typeName === 'page');
  return (page?.id as string | undefined) ?? DEFAULT_PAGE_ID;
}

export async function loadFile(path: string): Promise<TldrFile> {
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw) as TldrFile;
}

export async function saveFile(path: string, file: TldrFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2));
  await fs.rename(tmp, path);
}

export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const release = await lockfile.lock(path, {
    retries: { retries: 10, factor: 1.5, minTimeout: 50, maxTimeout: 1000 },
    stale: 30_000,
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export function newId(prefix: 'shape' | 'binding' | 'asset'): string {
  return `${prefix}:${nanoid(21)}`;
}

export function shapesOf(file: TldrFile): TLRecord[] {
  return file.records.filter((r) => r.typeName === 'shape');
}

export function bindingsOf(file: TldrFile): TLRecord[] {
  return file.records.filter((r) => r.typeName === 'binding');
}

export function nextIndex(file: TldrFile, parentId: string = firstPageId(file)): IndexKey {
  const indices = shapesOf(file)
    .filter((s) => s.parentId === parentId)
    .map((s) => s.index as IndexKey)
    .sort();
  const last = indices[indices.length - 1] ?? (ZERO_INDEX_KEY as IndexKey);
  return getIndexAbove(last);
}

export function findShape(file: TldrFile, id: string): TLRecord | undefined {
  return file.records.find((r) => r.typeName === 'shape' && r.id === id);
}

export function bindingsForShape(file: TldrFile, shapeId: string): TLRecord[] {
  return bindingsOf(file).filter((b) => b.fromId === shapeId || b.toId === shapeId);
}

export function arrowBetween(file: TldrFile, aId: string, bId: string): TLRecord | undefined {
  const bindings = bindingsOf(file);
  const arrowsAtA = bindings.filter((b) => b.toId === aId);
  for (const ba of arrowsAtA) {
    const arrowId = ba.fromId as string;
    const peerBinding = bindings.find((b) => b.fromId === arrowId && b.toId === bId && b.id !== ba.id);
    if (peerBinding) return findShape(file, arrowId);
  }
  return undefined;
}

export function pageOfShape(file: TldrFile, shapeId: string): string | undefined {
  let cur: TLRecord | undefined = findShape(file, shapeId);
  const seen = new Set<string>();
  while (cur) {
    const parentId = cur.parentId as string | undefined;
    if (!parentId) return undefined;
    if (seen.has(parentId)) return undefined;
    seen.add(parentId);
    if (parentId.startsWith('page:')) return parentId;
    cur = findShape(file, parentId);
  }
  return undefined;
}

export function replaceRecord(file: TldrFile, record: TLRecord): TldrFile {
  return {
    ...file,
    records: file.records.map((r) => (r.id === record.id ? record : r)),
  };
}

export function appendRecord(file: TldrFile, record: TLRecord): TldrFile {
  return { ...file, records: [...file.records, record] };
}

export function removeRecord(file: TldrFile, id: string): TldrFile {
  return { ...file, records: file.records.filter((r) => r.id !== id) };
}
