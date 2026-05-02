import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { createEmptyFile } from '../src/tools.js';

export type TestCtx = { file: string };

export function withTempFile(): TestCtx {
  const ctx: TestCtx = { file: '' };

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tldraw-mcp-test-'));
    ctx.file = path.join(dir, 'doc.tldr');
    await createEmptyFile({ file: ctx.file, overwrite: true });
  });

  afterEach(async () => {
    if (ctx.file) {
      await fs.rm(path.dirname(ctx.file), { recursive: true, force: true });
    }
  });

  return ctx;
}
