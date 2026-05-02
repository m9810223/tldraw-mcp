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

## Install

### Option 1 · `npx` (no install, recommended)

```bash
npx -y github:m9810223/tldraw-mcp
```

First run clones, runs `npm install`, then triggers the `prepare` script which builds `dist/`. Subsequent runs are cached.

Pin a branch / tag / commit:

```bash
npx -y github:m9810223/tldraw-mcp#main
npx -y github:m9810223/tldraw-mcp#v0.1.0
npx -y github:m9810223/tldraw-mcp#abc1234
```

### Option 2 · Global install

```bash
npm install -g github:m9810223/tldraw-mcp
tldraw-mcp   # the bin is on PATH
```

### Option 3 · Private repo over SSH

```bash
npx -y git+ssh://git@github.com/m9810223/tldraw-mcp.git
```

### Option 4 · Local clone (for development)

```bash
git clone https://github.com/m9810223/tldraw-mcp.git
cd tldraw-mcp
npm install
npm run build
node dist/index.js   # stdio MCP — waits on stdin
```

### Requirements

- Node.js ≥ 20 (enforced by `engines.node`)
- `jq` on `PATH` (only required for the `exec_jq` tool)
  - macOS: `brew install jq`
  - Debian/Ubuntu: `sudo apt-get install -y jq`

## Wire up to Claude Code

`claude mcp add` (recommended). The `--` separator is required so `-y` is
passed to `npx` instead of being parsed as a `claude mcp add` flag:

```bash
claude mcp add tldraw -- npx -y github:m9810223/tldraw-mcp
```

Add `-s user` for global (all projects) or `-s project` for a `.mcp.json`
checked into the repo. Default is `-s local` (this project, your machine).

…or by editing `.mcp.json` (project) / `~/.claude.json` (user-global):

```json
{
  "mcpServers": {
    "tldraw": {
      "command": "npx",
      "args": ["-y", "github:m9810223/tldraw-mcp"]
    }
  }
}
```

If you installed globally with Option 2:

```json
{
  "mcpServers": {
    "tldraw": { "command": "tldraw-mcp" }
  }
}
```

Restart Claude Code, then `/mcp` should list the `tldraw` server with 17 tools.

## Removing the MCP server

```bash
claude mcp remove tldraw
```

Adjust scope when you registered with a specific one — `claude mcp remove tldraw -s user` or `-s project`. List what's currently registered with `claude mcp list`.

To also remove the npx cache so a fresh `claude mcp add` later re-clones:

```bash
rm -rf ~/.npm/_npx
```

If you used Option 2 (`npm install -g github:m9810223/tldraw-mcp`):

```bash
npm uninstall -g tldraw-mcp
```

## Forcing a reinstall (cache busting)

`npx -y github:m9810223/tldraw-mcp` caches the clone under `~/.npm/_npx/`,
so subsequent runs use the cached version even after upstream pushes new
commits. Three ways to refresh:

### Option A · Pin a specific commit / branch / tag

```bash
claude mcp remove tldraw
claude mcp add tldraw -- npx -y github:m9810223/tldraw-mcp#main
# or pin a commit / tag for reproducibility
claude mcp add tldraw -- npx -y github:m9810223/tldraw-mcp#abc1234
```

`npx` treats `#<ref>` as part of the spec key, so a different ref always
forces a fresh clone.

### Option B · Wipe the npx cache (most aggressive)

```bash
rm -rf ~/.npm/_npx
```

Affects every `npx -y ...` cache, not just this project. Next call to any
`npx` package will re-clone / re-download.

### Option C · Clone locally and point at it

When iterating on the MCP itself, skip `npx` entirely:

```bash
git clone https://github.com/m9810223/tldraw-mcp.git ~/tldraw-mcp
cd ~/tldraw-mcp && npm install && npm run build

claude mcp remove tldraw
claude mcp add tldraw -- node ~/tldraw-mcp/dist/index.js
```

Now `git pull && npm run build` is enough to pick up changes — no cache
involved.

### Verifying which version is loaded

```bash
# Inspect the cached npx clone (commit hash)
git -C ~/.npm/_npx/*/node_modules/tldraw-mcp log --oneline -3 2>/dev/null

# Or check the live MCP server
claude mcp list
```

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
