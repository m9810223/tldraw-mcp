---
name: tldraw-screenshot
description: Render a `.tldr` file to a PNG by loading it into tldraw.com via `playwright-cli`, so you can SEE the diagram instead of reading raw JSON. Use whenever a `.tldr` file is involved and you need to inspect what it actually looks like — verifying layout / arrows / colors / text after editing with the `tldraw-m9810223` MCP, sharing a render with the user, sanity-checking a generated diagram, or comparing checkpoints. Trigger on phrases like "show me the tldraw", "screenshot the tldr", "what does this diagram look like", "看一下這張圖" — anything that implies visual inspection of a `.tldr` file. Don't push the screenshot back onto the user; the workflow below takes ~5 s once the browser is warm and puts the pixels in your context.
---

# tldraw-screenshot

Load a `.tldr` file into tldraw.com (in a headed `playwright-cli` session) and screenshot the canvas. Raw JSON tells you positions and labels, but only the rendered pixels show whether arrows overlap, text is cut, or the layout actually reads well. Run this whenever you (or the user) want to look at a tldraw diagram, then `Read` the PNG to bring the image into your context.

## Workflow

A sequence of `playwright-cli` commands — no bundled script — so you can see and adapt every step. The five gotchas in the next section explain why each command looks the way it does.

### 1. Get a browser session on tldraw.com

Every `playwright-cli` invocation in this workflow uses `-s=tldraw-screenshot` so the browser is isolated from the user's default session and from other concurrent `playwright-cli` work.

```bash
# Reuse if open, else launch
playwright-cli list 2>&1 | grep -q "tldraw-screenshot:" \
  || playwright-cli -s=tldraw-screenshot open "https://tldraw.com"

# Navigate if we're on some other URL
CURRENT_URL=$(playwright-cli -s=tldraw-screenshot --raw eval "() => location.href" 2>/dev/null || echo "")
case "$CURRENT_URL" in
  *tldraw.com*) ;;
  *) playwright-cli -s=tldraw-screenshot goto "https://tldraw.com" && sleep 5 ;;
esac

# Bigger viewport = more pixels per shape after zoomToFit
playwright-cli -s=tldraw-screenshot resize 2400 1600
```

### 2. Wait for the editor to mount

```bash
for _ in $(seq 1 20); do
  READY=$(playwright-cli -s=tldraw-screenshot --raw eval "() => typeof window.editor !== 'undefined'" 2>/dev/null)
  [[ "$READY" == "true" ]] && break
  sleep 1
done
```

### 3. Load the `.tldr` and zoom to fit

```bash
# cd into the .tldr's parent — playwright-cli's allowed roots are cwd + cwd/.playwright-cli
cd "$(dirname /path/to/file.tldr)"

B64=$(base64 < file.tldr | tr -d '\n')   # portable: works on macOS (BSD) and Linux (GNU)
playwright-cli -s=tldraw-screenshot --raw eval "() => { const b64='$B64'; const text=new TextDecoder().decode(new Uint8Array([...atob(b64)].map(c=>c.charCodeAt(0)))); const j=JSON.parse(text); const store=Object.fromEntries((j.records||[]).map(r=>[r.id,r])); window.editor.store.loadStoreSnapshot({schema:j.schema, store}); window.editor.zoomToFit(); return j.records.length; }"
sleep 2
```

### 4. Screenshot, then read

```bash
playwright-cli -s=tldraw-screenshot screenshot --filename=render.png   # lands in cwd
# Then in Claude:
# Read(file_path="<cwd>/render.png")
```

For dense diagrams, bump `playwright-cli -s=tldraw-screenshot resize 3200 2000` (or larger) before step 3 so text stays legible after `zoomToFit`.

## Why it works (the five gotchas)

1. **`loadStoreSnapshot` wants a different shape than `.tldr`.** Files store `{tldrawFileFormatVersion, schema, records: [...]}`, but the API takes `{schema, store: {[id]: record}}`. The eval rebuilds the shape via `Object.fromEntries(records.map(r => [r.id, r]))`. Skipping this is the #1 reason "load" silently does nothing.
2. **`window.editor` is set asynchronously after navigation.** Calling into it too early gives "Execution context was destroyed" or `editor is undefined`. The polling loop in step 2 avoids both.
3. **`--raw eval` accepts a 45 KB inline string** because base64 is alphanumeric + `+/=` only — no shell escapes needed. Don't try to `JSON.stringify` the records inline; just `atob` decode.
4. **`playwright-cli` restricts file paths to allowed roots** (cwd and `cwd/.playwright-cli/`). That's why step 3 `cd`s to the `.tldr`'s parent and step 4 saves a relative filename. If you need the PNG elsewhere, `mv` it after.
5. **`zoomToFit` is synchronous but the camera tween isn't.** The `sleep 2` after step 3 lets the animation settle so the screenshot captures the final framing.

## Failure modes

- **Editor never becomes ready** (step 2 loop times out without `READY=true`): tldraw.com may have changed its bootstrap or the page failed to load. Surface this to the user — don't silently continue, the load in step 3 will throw a less obvious error.
- **`load` returns a number but the canvas looks empty**: usually means the snapshot shape was wrong. Re-check step 3's `Object.fromEntries` rebuild.
- **PNG is just the tldraw landing page / toolbar with no shapes**: `zoomToFit` probably ran before shapes settled. Increase the `sleep` after `zoomToFit` to 3–5 s.

## When NOT to use

- User wants a polished PNG for slides → tldraw.com's File → Export As gives a clean canvas without the toolbar overlay. The viewport screenshot here includes tldraw.com's UI chrome.
- You only need shape ids / positions / labels → use `mcp__tldraw-m9810223__list_shapes` directly, no rendering needed.

## Pairs with `tldraw-m9810223` MCP

Natural editing loop: edit shapes via the MCP → render via this skill → read the PNG → adjust via MCP → render again. This skill has no dependency on the MCP being installed — it only reads the resulting `.tldr` file.
