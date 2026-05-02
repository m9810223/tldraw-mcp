import { describe, expect, it } from 'vitest';
import { extractText, measureText, safeArrowLabel } from '../../src/text-metrics.js';

describe('safeArrowLabel', () => {
  it('leaves short multi-word labels alone', () => {
    expect(safeArrowLabel('1. Access app')).toBe('1. Access app');
  });

  it('leaves single-word labels alone (cannot help)', () => {
    expect(safeArrowLabel('/authorize')).toBe('/authorize');
  });

  it('leaves user-controlled multi-line labels alone', () => {
    expect(safeArrowLabel('Step 1\nGo here')).toBe('Step 1\nGo here');
  });

  it('breaks at every space when any word is long enough to wrap mid-word', () => {
    expect(safeArrowLabel('1. Initiates login')).toBe('1.\nInitiates\nlogin');
  });

  it('respects custom maxWordLen', () => {
    expect(safeArrowLabel('hi there', 3)).toBe('hi\nthere');
  });

  it('returns empty for empty input', () => {
    expect(safeArrowLabel('')).toBe('');
  });
});

describe('measureText', () => {
  it('returns padding-only dimensions for empty text', () => {
    const r = measureText({ text: '', size: 'm' });
    expect(r.lines).toBe(1);
    expect(r.w).toBe(32);
  });

  it('scales width by character count when no maxWidth', () => {
    const short = measureText({ text: 'hi', size: 'm' });
    const long = measureText({ text: 'hello world hello world', size: 'm' });
    expect(long.w).toBeGreaterThan(short.w);
    expect(long.lines).toBe(1);
  });

  it('wraps at maxWidth and grows height', () => {
    const single = measureText({ text: 'one two three four five six seven eight', size: 'm' });
    const wrapped = measureText({
      text: 'one two three four five six seven eight',
      size: 'm',
      maxWidth: 100,
    });
    expect(wrapped.lines).toBeGreaterThan(single.lines);
    expect(wrapped.h).toBeGreaterThan(single.h);
    expect(wrapped.w).toBeLessThanOrEqual(100);
  });

  it('honors explicit newlines as separate lines', () => {
    const r = measureText({ text: 'line one\nline two\nline three', size: 'm' });
    expect(r.lines).toBe(3);
  });

  it('breaks long single words that exceed maxWidth', () => {
    const r = measureText({ text: 'supercalifragilisticexpialidocious', size: 'm', maxWidth: 80 });
    expect(r.lines).toBeGreaterThan(1);
  });

  it('xl is bigger than s for the same text', () => {
    const small = measureText({ text: 'hello', size: 's' });
    const xl = measureText({ text: 'hello', size: 'xl' });
    expect(xl.w).toBeGreaterThan(small.w);
    expect(xl.h).toBeGreaterThan(small.h);
  });
});

describe('extractText', () => {
  it('reads richText paragraphs', () => {
    const shape = {
      typeName: 'shape',
      id: 'shape:x',
      type: 'geo',
      props: {
        richText: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
          ],
        },
      },
    } as never;
    expect(extractText(shape)).toBe('first\nsecond');
  });

  it('falls back to plain text prop', () => {
    const shape = {
      typeName: 'shape',
      id: 'shape:x',
      type: 'arrow',
      props: { text: 'hi' },
    } as never;
    expect(extractText(shape)).toBe('hi');
  });

  it('returns empty when no text fields present', () => {
    const shape = { typeName: 'shape', id: 'shape:x', type: 'geo', props: {} } as never;
    expect(extractText(shape)).toBe('');
  });
});
