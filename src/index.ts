#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  connect,
  connectSchema,
  createEmptyFile,
  createEmptyFileSchema,
  createGroup,
  createGroupSchema,
  createPage,
  createPageSchema,
  listPages,
  listPagesSchema,
  moveToPage,
  moveToPageSchema,
  ungroup,
  ungroupSchema,
  createRect,
  createRectSchema,
  createText,
  createTextSchema,
  deleteShape,
  deleteShapeSchema,
  execJq,
  execJqSchema,
  getShape,
  getShapeSchema,
  listCheckpointsTool,
  listCheckpointsSchema,
  listShapes,
  listShapesSchema,
  restoreCheckpointTool,
  restoreCheckpointSchema,
  saveCheckpointTool,
  saveCheckpointSchema,
  searchApi,
  searchApiSchema,
  updateShape,
  updateShapeSchema,
} from './tools.js';

const tools = {
  create_empty_file: {
    description: 'Create a new empty .tldr file with one default page. Errors if file exists unless overwrite=true.',
    schema: createEmptyFileSchema,
    handler: createEmptyFile,
  },
  create_rect: {
    description: 'Create a rectangle shape on the main page. Returns its id.',
    schema: createRectSchema,
    handler: createRect,
  },
  create_text: {
    description: 'Create a text shape on the main page. Returns its id.',
    schema: createTextSchema,
    handler: createText,
  },
  list_shapes: {
    description: 'List shapes (id, type, x, y, label only - props omitted to save tokens).',
    schema: listShapesSchema,
    handler: listShapes,
  },
  get_shape: {
    description: 'Get the full record of a single shape by id.',
    schema: getShapeSchema,
    handler: getShape,
  },
  update_shape: {
    description: 'Update a shape via shallow merge. Pass nested {"props": {...}} to update props.',
    schema: updateShapeSchema,
    handler: updateShape,
  },
  delete_shape: {
    description: 'Delete a shape by id.',
    schema: deleteShapeSchema,
    handler: deleteShape,
  },
  connect: {
    description: 'Connect two shapes with an arrow. Arrow position is binding-driven (start/end stored as 0,0 fallback). Returns arrow id + binding ids.',
    schema: connectSchema,
    handler: connect,
  },
  create_group: {
    description: 'Group existing shapes into a new group. Reparents the given shape ids under a new group shape.',
    schema: createGroupSchema,
    handler: createGroup,
  },
  ungroup: {
    description: 'Dissolve a group: reparent its children to the group\'s parent and delete the group shape.',
    schema: ungroupSchema,
    handler: ungroup,
  },
  create_page: {
    description: 'Create a new page in the document. Returns the new page id.',
    schema: createPageSchema,
    handler: createPage,
  },
  list_pages: {
    description: 'List all pages with id, name, and ordering index.',
    schema: listPagesSchema,
    handler: listPages,
  },
  move_to_page: {
    description: 'Move shapes to a different page by reparenting them. Note: arrows and bindings should move together for correctness.',
    schema: moveToPageSchema,
    handler: moveToPage,
  },
  search_api: {
    description:
      'List supported tldraw shape types and their required props. Use this to discover what can be created before falling back to exec_jq.',
    schema: searchApiSchema,
    handler: searchApi,
  },
  exec_jq: {
    description:
      'Escape hatch: run a jq filter against the .tldr JSON. Set write=true to persist (auto-checkpoints first).',
    schema: execJqSchema,
    handler: execJq,
  },
  save_checkpoint: {
    description: 'Copy the .tldr file to a timestamped backup. Returns the backup path.',
    schema: saveCheckpointSchema,
    handler: saveCheckpointTool,
  },
  list_checkpoints: {
    description: 'List checkpoint backups for a .tldr file, newest first.',
    schema: listCheckpointsSchema,
    handler: listCheckpointsTool,
  },
  restore_checkpoint: {
    description:
      'Restore a checkpoint over the .tldr file. Omits checkpoint to restore the most recent.',
    schema: restoreCheckpointSchema,
    handler: restoreCheckpointTool,
  },
} as const;

const server = new Server(
  { name: 'tldraw-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema, { target: 'openApi3' }) as Record<string, unknown>,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name as keyof typeof tools;
  const tool = tools[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const args = tool.schema.parse(request.params.arguments ?? {});
  const result = await (tool.handler as (a: unknown) => Promise<unknown>)(args);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

await server.connect(new StdioServerTransport());
