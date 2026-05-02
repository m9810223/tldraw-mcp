import { createTLSchema } from '@tldraw/tlschema';
import type { TldrFile } from './store.js';

export function emptyTldrFile(): TldrFile {
  const schema = createTLSchema();
  const serialized = schema.serialize();

  return {
    tldrawFileFormatVersion: 1,
    schema: serialized as unknown as TldrFile['schema'],
    records: [
      {
        gridSize: 10,
        name: '',
        meta: {},
        id: 'document:document',
        typeName: 'document',
      },
      {
        meta: {},
        id: 'page:page',
        name: 'Page 1',
        index: 'a1',
        typeName: 'page',
      },
    ],
  };
}
