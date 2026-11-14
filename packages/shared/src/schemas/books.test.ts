import { describe, expect, it } from 'vitest';
import { parsePreviewPages } from './books';

describe('parsePreviewPages', () => {
  it('parses ranges and singles, sorted and unique', () => {
    expect(parsePreviewPages('1-5,9')).toEqual([1, 2, 3, 4, 5, 9]);
    expect(parsePreviewPages(' 9 , 2-3 ,3')).toEqual([2, 3, 9]);
    expect(parsePreviewPages('')).toEqual([]);
  });
  it('rejects bad input', () => {
    for (const bad of ['0', '5-2', 'a', '1,,2', '1-', '-3', '1-9999']) expect(parsePreviewPages(bad), bad).toBeNull();
  });
});
