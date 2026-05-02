import { describe, expect, it } from 'vitest';
import { bendValuesFor, groupOverlappingArrows, sortByPriority } from '../../src/arrow-bending.js';

describe('bendValuesFor', () => {
  it('returns 0 for a single arrow', () => {
    expect(bendValuesFor(1, 30)).toEqual([0]);
  });

  it('returns symmetric pair for 2 arrows', () => {
    expect(bendValuesFor(2, 30)).toEqual([-30, 30]);
  });

  it('keeps the middle arrow straight for 3 arrows', () => {
    expect(bendValuesFor(3, 30)).toEqual([-30, 0, 30]);
  });

  it('spreads 4 arrows symmetrically across [-amount, +amount]', () => {
    const bends = bendValuesFor(4, 30);
    expect(bends).toEqual([-30, -10, 10, 30]);
    expect(bends[0] + bends[3]).toBe(0);
    expect(bends[1] + bends[2]).toBe(0);
  });

  it('returns empty array for 0', () => {
    expect(bendValuesFor(0, 30)).toEqual([]);
  });
});

describe('groupOverlappingArrows', () => {
  it('returns empty for no parallel pairs', () => {
    expect(
      groupOverlappingArrows([
        { arrowId: 'a1', fromId: 's1', toId: 's2' },
        { arrowId: 'a2', fromId: 's2', toId: 's3' },
      ]),
    ).toEqual([]);
  });

  it('groups arrows with the same shape pair regardless of direction', () => {
    const groups = groupOverlappingArrows([
      { arrowId: 'a1', fromId: 's1', toId: 's2' },
      { arrowId: 'a2', fromId: 's2', toId: 's1' },
      { arrowId: 'a3', fromId: 's1', toId: 's3' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(['a1', 'a2']);
  });

  it('handles 3+ arrows in one group', () => {
    const groups = groupOverlappingArrows([
      { arrowId: 'a1', fromId: 's1', toId: 's2' },
      { arrowId: 'a2', fromId: 's1', toId: 's2' },
      { arrowId: 'a3', fromId: 's2', toId: 's1' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});

describe('sortByPriority', () => {
  it('returns input order when no priority given', () => {
    expect(sortByPriority(['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('places listed ids first in their priority order', () => {
    expect(sortByPriority(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b']);
  });

  it('keeps unlisted ids in original drawing order', () => {
    expect(sortByPriority(['a', 'b', 'c', 'd'], ['c'])).toEqual(['c', 'a', 'b', 'd']);
  });
});
