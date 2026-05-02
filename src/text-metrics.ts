import type { TLRecord } from './store.js';

const SIZE_METRICS: Record<'s' | 'm' | 'l' | 'xl', { charWidth: number; lineHeight: number }> = {
  s: { charWidth: 7, lineHeight: 18 },
  m: { charWidth: 9, lineHeight: 28 },
  l: { charWidth: 13, lineHeight: 40 },
  xl: { charWidth: 19, lineHeight: 56 },
};

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
    let current = '';
    for (const word of words) {
      const candidate = current + word;
      if (candidate.length * charWidth <= maxLinePixels) {
        current = candidate;
        continue;
      }
      if (current.length > 0) {
        out.push(current.trimEnd());
        current = word.trimStart();
      } else {
        let chunk = word;
        const charsPerLine = Math.max(1, Math.floor(maxLinePixels / charWidth));
        while (chunk.length > charsPerLine) {
          out.push(chunk.slice(0, charsPerLine));
          chunk = chunk.slice(charsPerLine);
        }
        current = chunk;
      }
    }
    if (current.length > 0) out.push(current);
  }
  return out.length > 0 ? out : [''];
}
