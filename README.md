# tldraw-mcp

Minimal MCP server for editing tldraw `.tldr` files via JSON manipulation. Headless, no browser needed.

## Status

Working skeleton. Schema validation is wired (`@tldraw/tlschema` validators run before every write), fractional indexing uses `@tldraw/utils`, file writes are guarded by `proper-lockfile`. Output verified end-to-end against the real tldraw runtime via `Store.loadStoreSnapshot()` in the contract test layer.

## Tools

### File / page lifecycle

| Tool                | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `create_empty_file` | Create a fresh `.tldr` with a default page                           |
| `create_page`       | Add a new page                                                       |
| `list_pages`        | List pages with id, name, ordering index                             |
| `move_to_page`      | Move shapes; `bindings: 'error' \| 'pull' \| 'cut'` controls binding handling |

### Shapes

| Tool           | What it does                                                       |
| -------------- | ------------------------------------------------------------------ |
| `create_rect`  | Create a rectangle (geo shape)                                     |
| `create_text`  | Create a text shape                                                |
| `create_group` | Group shapes by reparenting them                                   |
| `ungroup`      | Dissolve a group, reparenting its children to the group's parent   |
| `connect`      | Arrow + bindings between two same-page shapes                      |
| `list_shapes`  | List shapes — id, type, x, y, label only                           |
| `get_shape`    | Full record of one shape by id                                     |
| `update_shape` | Shallow-merge patch (use nested `{ "props": {...} }` for prop edits) |
| `delete_shape` | Delete by id; `cascade: true` (default) also removes attached arrows + bindings |

### Discovery & escape hatch (inspired by official `tldraw-mcp-app`)

| Tool         | What it does                                                                            | Token cost |
| ------------ | --------------------------------------------------------------------------------------- | ---------- |
| `search_api` | List supported shape types + curated required props. Pass `{type, verbose:true}` to dump live prop names from `@tldraw/tlschema` for any type (including ones not in the curated list) | low / medium  |
| `exec_jq`    | Run a `jq` filter against the file. `write=true` persists (auto-checkpoint first)       | varies     |

### Checkpoints (safety)

| Tool                 | What it does                                           | Token cost |
| -------------------- | ------------------------------------------------------ | ---------- |
| `save_checkpoint`    | Copy `.tldr` to a timestamped backup                   | low        |
| `list_checkpoints`   | List backups, newest first                             | low        |
| `restore_checkpoint` | Restore a backup (most recent if `checkpoint` omitted) | low        |

The token-saving design: tools take primitive args, return ids or `ok`. The full JSON only enters context when you call `get_shape` deliberately.

## Install / Update / Remove

Requires **Node ≥ 20**. `jq` only needed for `exec_jq` (`brew install jq` / `apt-get install jq`).

```bash
# Install (or reinstall after upstream changes)
claude mcp remove tldraw-m9810223 2>/dev/null; rm -rf ~/.npm/_npx
claude mcp add tldraw-m9810223 -- npx -y github:m9810223/tldraw-mcp

# Remove
claude mcp remove tldraw-m9810223
```

The first arg (`tldraw-m9810223`) is the local server name — pick whatever you like, then refer to it the same way in subsequent commands. Restart Claude Code, then `/mcp` lists it with 22 tools.

## Wire up to other MCP clients

Same JSON shape, different config file location:

| Client          | Config path                                                              |
| --------------- | ------------------------------------------------------------------------ |
| Claude Desktop  | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Cursor          | `~/.cursor/mcp.json`                                                     |
| VS Code         | `.vscode/mcp.json`                                                       |

## Bootstrapping a `.tldr` file

Use the `create_empty_file` tool, or save an empty canvas from tldraw.com and point tools at the absolute path.

```
create_empty_file({ file: "/tmp/demo.tldr" })
```

## Design comparison vs official `tldraw-mcp-app`

The Cloudflare-hosted official MCP exposes only `search` + `exec` (run any JS in a live tldraw Editor). This skeleton goes the opposite way — typed JSON edits over `.tldr` files — and borrows the discovery pattern (`search_api`) and escape hatch (`exec_jq`) so an LLM can fall through when typed tools don't cover an operation.

|              | Official `tldraw-mcp-app`           | This skeleton                                  |
| ------------ | ----------------------------------- | ---------------------------------------------- |
| Transport    | streamable-http + sse (Cloudflare)  | stdio (works in Claude Code directly)          |
| Runtime      | Real tldraw Editor in widget iframe | Pure Node, edits raw JSON                      |
| Tools        | 2 (`search`, `exec`) + checkpoints  | 17: file/page lifecycle + 9 shape ops + search_api + exec_jq + ckpt |
| Live preview | Yes (widget iframe)                 | No (open the file in tldraw to view)           |
| Coverage     | Whole Editor API                    | Geo / text / arrow + jq escape hatch           |

## Known gaps

- `index` (z-order) only supports appending above the current max — no insert-between
- No alignment / distribution tools (use `update_shape` to set `x`/`y` directly, or `exec_jq`)
- No image / video / asset support
- Schema version pinning is informational only — opening a file in a newer tldraw may trigger migrations
- `search_api` curated list is hand-maintained alongside the live `@tldraw/tlschema` reflection

## Architecture

```
src/
  index.ts       MCP server entry, tool registration (stdio transport)
  tools.ts       Tool handlers + zod input schemas
  shapes.ts      tldraw record factories (geo/text/arrow/group/binding)
  store.ts       Load/save .tldr + withFileLock; helpers (id gen, indexing, find, page-of-shape, bindings-for-shape)
  template.ts    Empty .tldr generator using @tldraw/tlschema serialize()
  validate.ts    validateShape / validateBinding using createShapeValidator + createBindingValidator
  checkpoint.ts  Timestamped backups under .tldraw-mcp-checkpoints/
  jq.ts          Shell-out to jq for the exec_jq escape hatch

test/
  unit/          store + validate (13 tests)
  integration/   tools end-to-end on tmp .tldr (18 tests)
  contract/      loadStoreSnapshot against real @tldraw/store (4 tests)
```

Pure JSON manipulation — no `@tldraw/store`, no DOM, no React.
