# tldraw-m9810223

A Claude Code plugin: 26-tool MCP server for editing tldraw `.tldr` files via JSON manipulation (headless, no browser needed), plus a `tldraw-screenshot` skill that renders a `.tldr` to PNG via tldraw.com so Claude can SEE the diagram.

## Status

Working skeleton. Schema validation is wired (`@tldraw/tlschema` validators run before every write), fractional indexing uses `@tldraw/utils`, file writes are guarded by `proper-lockfile`. Output verified end-to-end against the real tldraw runtime via `Store.loadStoreSnapshot()` in the contract test layer.

## Quick Start

Requires **Node ≥ 20**.

**1. Install as a Claude Code plugin** (one command registers the marketplace, the second installs the bundled MCP server + skill):

```bash
claude plugin marketplace add m9810223/tldraw-m9810223
claude plugin install tldraw-m9810223@tldraw-m9810223
```

Restart Claude Code. `/mcp` lists `tldraw-m9810223` (26 tools); `/plugin` lists `tldraw-m9810223`; the `tldraw-screenshot` skill is available too.

If you'd rather wire just the MCP server (no skill), see [Install / Update / Remove](#install--update--remove) below.

**2. Try the demo prompt** in Claude Code:

```md
Draw the Shai-Hulud supply-chain attack flow described in this article with MCP `tldraw-m9810223`, save to `./demo.tldr`:
https://semgrep.dev/blog/2026/malicious-dependency-in-pytorch-lightning-used-for-ai-training/

- Match the actors and how data/control flows between them
- Polish the result at the end
```

**3. View the result** — drop `./demo.tldr` onto [tldraw.com](https://tldraw.com), or use the [tldraw VS Code extension](https://marketplace.visualstudio.com/items?itemName=tldraw-org.tldraw-vscode) for live preview.

![Shai-Hulud supply-chain attack flow recreated by tldraw-m9810223](docs/demo.png)

Source file: [`docs/demo.tldr`](docs/demo.tldr)

## Tools

### File / page lifecycle

| Tool                | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `create_empty_file` | Create a fresh `.tldr` with a default page                                    |
| `create_page`       | Add a new page                                                                |
| `list_pages`        | List pages with id, name, ordering index                                      |
| `move_to_page`      | Move shapes; `bindings: 'error' \| 'pull' \| 'cut'` controls binding handling |

### Shapes

| Tool           | What it does                                                                    |
| -------------- | ------------------------------------------------------------------------------- |
| `create_rect`  | Create a rectangle (geo shape)                                                  |
| `create_text`  | Create a text shape                                                             |
| `create_group` | Group shapes by reparenting them                                                |
| `ungroup`      | Dissolve a group, reparenting its children to the group's parent                |
| `connect`      | Arrow + bindings between two same-page shapes                                   |
| `list_shapes`  | List shapes — id, type, x, y, label only                                        |
| `get_shape`    | Full record of one shape by id                                                  |
| `update_shape` | Shallow-merge patch (use nested `{ "props": {...} }` for prop edits)            |
| `delete_shape` | Delete by id; `cascade: true` (default) also removes attached arrows + bindings |

### Layout / text fitting

| Tool                      | What it does                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `fit_to_text`             | Resize a geo/text shape to fit its current text content                                                                                      |
| `align`                   | Align shapes on an axis (left/right/top/bottom/center-x/center-y)                                                                            |
| `distribute`              | Even-space shapes between the outermost two                                                                                                  |
| `auto_layout`             | Lay shapes out in a horizontal/vertical chain                                                                                                |
| `graph_layout`            | Dagre layout for arrow-connected shapes (best for non-chain topologies)                                                                      |
| `measure_arrow_labels`    | Report label sizes + endpoint distances for labeled arrows                                                                                   |
| `bend_overlapping_arrows` | Bend parallel arrows (same shape pair) symmetrically; `priority[]` keeps important arrows straight. `graph_layout` calls this automatically. |
| `polish_layout`           | One-shot finisher: `fit_to_text` every node + `graph_layout` (auto-bends arrows). Use as the last step after building a fresh diagram.       |

### Discovery & escape hatch

| Tool         | What it does                                                                                                                                                                           | Token cost   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `search_api` | List supported shape types + curated required props. Pass `{type, verbose:true}` to dump live prop names from `@tldraw/tlschema` for any type (including ones not in the curated list) | low / medium |
| `exec_jq`    | Run a `jq` filter against the file. `write=true` persists (auto-checkpoint first)                                                                                                      | varies       |

### Checkpoints (safety)

| Tool                 | What it does                                           | Token cost |
| -------------------- | ------------------------------------------------------ | ---------- |
| `save_checkpoint`    | Copy `.tldr` to a timestamped backup                   | low        |
| `list_checkpoints`   | List backups, newest first                             | low        |
| `restore_checkpoint` | Restore a backup (most recent if `checkpoint` omitted) | low        |

The token-saving design: tools take primitive args, return ids or `ok`. The full JSON only enters context when you call `get_shape` deliberately.

## Install / Update / Remove

`jq` only needed for `exec_jq` (`brew install jq` / `apt-get install jq`).

### As a plugin (recommended — bundles MCP server + skill)

```bash
# Install (user scope by default)
claude plugin marketplace add m9810223/tldraw-m9810223
claude plugin install tldraw-m9810223@tldraw-m9810223

# Update
claude plugin update tldraw-m9810223

# Remove
claude plugin uninstall tldraw-m9810223
claude plugin marketplace remove tldraw-m9810223
```

### MCP server only (no skill)

Use this if you want the editing tools but not the screenshot skill, or you're on a Claude client that doesn't speak Code's plugin system.

```bash
# Install — user scope: every project on this machine
claude mcp remove tldraw-m9810223 -s user 2>/dev/null; rm -rf ~/.npm/_npx
claude mcp add -s user tldraw-m9810223 -- npx -y github:m9810223/tldraw-m9810223

# Install — local scope (default): only the current project directory
claude mcp remove tldraw-m9810223 2>/dev/null; rm -rf ~/.npm/_npx
claude mcp add tldraw-m9810223 -- npx -y github:m9810223/tldraw-m9810223
```

The first arg (`tldraw-m9810223`) is the local server name — pick whatever you like, then refer to it the same way in subsequent commands. Restart Claude Code, then `/mcp` lists it with 26 tools.

## Wire up to other MCP clients

Same JSON shape, different config file location:

| Client         | Config path                                                               |
| -------------- | ------------------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Cursor         | `~/.cursor/mcp.json`                                                      |
| VS Code        | `.vscode/mcp.json`                                                        |

## Bootstrapping a `.tldr` file

Use the `create_empty_file` tool, or save an empty canvas from tldraw.com and point tools at the absolute path.

```
create_empty_file({ file: "/tmp/demo.tldr" })
```

## Viewing / editing the output

| Tool                                                                                                     | Notes                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tldraw-screenshot` skill (bundled)                                                                      | Programmatic render to PNG via `playwright-cli` + tldraw.com. Triggers automatically when Claude wants to see a `.tldr`     |
| [tldraw.com](https://tldraw.com)                                                                         | Drag the `.tldr` file onto the page                                                                                         |
| [tldraw VS Code extension](https://marketplace.visualstudio.com/items?itemName=tldraw-org.tldraw-vscode) | Native `.tldr` preview + edit inside VS Code; survives file changes from the MCP server                                     |
| Tldraw Desktop / official editor                                                                         | Drop the file in                                                                                                            |

The VS Code extension is the smoothest dev loop — keep `code path/to/file.tldr` open in a tab while the MCP edits it; the editor refreshes on disk change.

The `tldraw-screenshot` skill is the smoothest **agent** loop — Claude edits via the MCP, renders via the skill, looks at the PNG, edits again. See [`skills/tldraw-screenshot/SKILL.md`](skills/tldraw-screenshot/SKILL.md) for the workflow and gotchas. Requires [`playwright-cli`](https://www.npmjs.com/package/@playwright/cli) on `PATH`.

## Design comparison vs official `tldraw-mcp-app`

The Cloudflare-hosted official MCP exposes only `search` + `exec` (run any JS in a live tldraw Editor). This skeleton goes the opposite way — typed JSON edits over `.tldr` files — and borrows the discovery pattern (`search_api`) and escape hatch (`exec_jq`) so an LLM can fall through when typed tools don't cover an operation.

|              | Official `tldraw-mcp-app`           | This skeleton                                                         |
| ------------ | ----------------------------------- | --------------------------------------------------------------------- |
| Transport    | streamable-http + sse (Cloudflare)  | stdio (works in Claude Code directly)                                 |
| Runtime      | Real tldraw Editor in widget iframe | Pure Node, edits raw JSON                                             |
| Tools        | 2 (`search`, `exec`) + checkpoints  | 26: file/page (4) + shape (9) + layout (8) + discovery (2) + ckpt (3) |
| Live preview | Yes (widget iframe)                 | No (open the file in tldraw to view)                                  |
| Coverage     | Whole Editor API                    | Geo / text / arrow + jq escape hatch                                  |

## Known gaps

- `index` (z-order) only supports appending above the current max — no insert-between
- No image / video / asset support
- Schema version pinning is informational only — opening a file in a newer tldraw may trigger migrations
- `search_api` curated list is hand-maintained alongside the live `@tldraw/tlschema` reflection

## Architecture

```
.claude-plugin/
  plugin.json       Plugin metadata + pointers to mcpServers + skills
  marketplace.json  Marketplace manifest so `claude plugin install` can find this
.mcp.json           Plugin-scoped MCP server declaration (npx-from-github)

skills/
  tldraw-screenshot/
    SKILL.md        Workflow for rendering .tldr → PNG via playwright-cli + tldraw.com

src/
  index.ts       MCP server entry, tool registration (stdio transport)
  tools.ts       Tool handlers + zod input schemas
  shapes.ts      tldraw record factories (geo/text/arrow/group/binding)
  store.ts       Load/save .tldr + withFileLock; helpers (id gen, indexing, find, page-of-shape, bindings-for-shape)
  template.ts    Empty .tldr generator using @tldraw/tlschema serialize()
  validate.ts    validateShape / validateBinding using createShapeValidator + createBindingValidator
  checkpoint.ts  Timestamped backups under .tldraw-mcp-checkpoints/
  jq.ts          Shell-out to jq for the exec_jq escape hatch
  text-metrics.ts Text size heuristics for autoFit + label measurement
  graph-layout.ts Dagre wrapper for graph_layout
  arrow-bending.ts Detect parallel-edge overlap + assign symmetric bend values

test/
  unit/          store + validate + text-metrics + arrow-bending (34 tests)
  integration/   tools end-to-end on tmp .tldr (39 tests)
  contract/      loadStoreSnapshot against real @tldraw/store (4 tests)
  boundary/      N-1 / N / N+1 limits + concurrent writes (89 tests)
```

Pure JSON manipulation — no `@tldraw/store`, no DOM, no React.
