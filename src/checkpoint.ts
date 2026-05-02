import fs from 'node:fs/promises';
import path from 'node:path';

const CHECKPOINT_DIR = '.tldraw-mcp-checkpoints';

function checkpointDir(filePath: string): string {
  return path.join(path.dirname(filePath), CHECKPOINT_DIR);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function saveCheckpoint(filePath: string, label?: string): Promise<string> {
  const dir = checkpointDir(filePath);
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(filePath);
  const tag = label ? `__${label.replace(/[^\w-]/g, '_')}` : '';
  const dest = path.join(dir, `${base}__${timestamp()}${tag}.bak`);
  await fs.copyFile(filePath, dest);
  return dest;
}

export async function listCheckpoints(filePath: string): Promise<{ path: string; mtime: string }[]> {
  const dir = checkpointDir(filePath);
  const base = path.basename(filePath);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const matches = entries.filter((e) => e.startsWith(`${base}__`) && e.endsWith('.bak'));
  const stats = await Promise.all(
    matches.map(async (e) => {
      const full = path.join(dir, e);
      const s = await fs.stat(full);
      return { path: full, mtime: s.mtime.toISOString() };
    }),
  );
  return stats.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export async function restoreCheckpoint(filePath: string, checkpointPath?: string): Promise<string> {
  let source = checkpointPath;
  if (!source) {
    const list = await listCheckpoints(filePath);
    if (list.length === 0) throw new Error(`No checkpoints found for ${filePath}`);
    source = list[0].path;
  }
  await fs.copyFile(source, filePath);
  return source;
}
