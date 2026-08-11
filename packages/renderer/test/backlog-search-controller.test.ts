import { describe, expect, it } from 'vitest';
import { BacklogSearchController, searchBacklog } from '../src/backlog-search-controller.js';

describe('BacklogSearchController', () => {
  it('trims and matches Latin case-insensitively while preserving Chinese and voice', () => {
    expect(searchBacklog([
      { speaker: '凛', text: '第一通电话', voice: 'v1' },
      { speaker: null, text: '雨声继续。' },
    ], ' 电话 ')).toEqual([{ index: 0, entry: { speaker: '凛', text: '第一通电话', voice: 'v1' } }]);
    expect(searchBacklog([{ speaker: 'Lynn', text: 'Night' }], 'night')).toHaveLength(1);
  });

  it('keeps original indices and deletes one Unicode code point', () => {
    const controller = new BacklogSearchController();
    controller.append('雨');
    controller.append('声');
    controller.backspace();
    expect(controller.query).toBe('雨');
    expect(controller.results([
      { speaker: null, text: '晴天' },
      { speaker: null, text: '雨声继续' },
    ])).toEqual([{ index: 1, entry: { speaker: null, text: '雨声继续' } }]);
    controller.clear();
    expect(controller.query).toBe('');
  });

  it('matches trimmed CJK and emoji queries without changing the entry identity', () => {
    const entries = [{ speaker: '凛', text: '雨夜🙂继续' }];
    expect(searchBacklog(entries, ' 雨夜🙂 ')).toEqual([{ index: 0, entry: entries[0] }]);
  });
});
