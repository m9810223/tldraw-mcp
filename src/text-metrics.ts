import type { TLRecord } from './store.js';

// Calibrated against tldraw's "draw" handwriting font (Caveat). Values err on the
// generous side so single-word boxes never get hard-wrapped: a too-narrow box would
// truncate a word like "User" → "Us / er", whereas a slightly oversized box just
// shows extra padding.
const SIZE_METRICS: Record<'s' | 'm' | 'l' | 'xl', { charWidth: number; lineHeight: number }> = {
  s: { charWidth: 11, lineHeight: 18 },
  m: { charWidth: 15, lineHeight: 28 },
  l: { charWidth: 22, lineHeight: 40 },
  xl: { charWidth: 32, lineHeight: 56 },
};

// tldraw arrow labels have no width prop — they wrap at ~14 chars (size m, draw font),
// breaking mid-word for words > ~7 chars. When at least one long word exists, we force
// breaks at whitespace so every word stays on its own line and tldraw never has to
// hard-break inside a word.
export function safeArrowLabel(text: string, maxWordLen = 8): string {
  if (!text || text.includes('\n')) return text;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return text;
  if (words.every((w) => w.length <= maxWordLen)) return text;
  return words.join('\n');
}

export function extractText(shape: TLRecord): string {
  const props = shape.props as Record<string, unknown> | undefined;
  if (!props) return '';
  if (typeof props.text === 'string' && props.text.length > 0) return props.text;
  const rt = props.richText as { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined;
  if (!rt?.content) return '';
  const lines: string[] = [];
  for (const para of rt.content) {
    const parts: string[] = [];
    for (const node of para.content ?? []) {
      if (typeof node.text === 'string') parts.push(node.text);
    }
    lines.push(parts.join(''));
  }
  return lines.join('\n');
}

export function measureText(args: {
  text: string;
  size?: 's' | 'm' | 'l' | 'xl';
  scale?: number;
  maxWidth?: number;
  padding?: number;
}): { w: number; h: number; lines: number } {
  const size = args.size ?? 'm';
  const scale = args.scale ?? 1;
  const padding = args.padding ?? 16;
  const { charWidth, lineHeight } = SIZE_METRICS[size];
  const cw = charWidth * scale;
  const lh = lineHeight * scale;

  if (args.text.length === 0) {
    return { w: padding * 2, h: lh + padding * 2, lines: 1 };
  }

  const maxLineWidth = args.maxWidth ? Math.max(args.maxWidth - padding * 2, cw) : Infinity;
  const lines = wrapLines(args.text, cw, maxLineWidth);
  const widest = Math.max(...lines.map((l) => l.length * cw));

  return {
    w: Math.ceil(widest + padding * 2),
    h: Math.ceil(lines.length * lh + padding * 2),
    lines: lines.length,
  };
}

function wrapLines(text: string, charWidth: number, maxLinePixels: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para.length === 0) {
      out.push('');
      continue;
    }
    if (maxLinePixels === Infinity || para.length * charWidth <= maxLinePixels) {
      out.push(para);
      continue;
    }
    const words = para.split(/(\s+)/);
    const charsPerLine = Math.max(1, Math.floor(maxLinePixels / charWidth));
    let current = '';
    for (const word of words) {
      const candidate = current + word;
      if (candidate.length * charWidth <= maxLinePixels) {
        current = candidate;
        continue;
      }
      if (current.length > 0) {
        out.push(current.trimEnd());
        current = '';
      }
      let chunk = word.trimStart();
      while (chunk.length > charsPerLine) {
        out.push(chunk.slice(0, charsPerLine));
        chunk = chunk.slice(charsPerLine);
      }
      current = chunk;
    }
    if (current.length > 0) out.push(current);
  }
  return out.length > 0 ? out : [''];
}
