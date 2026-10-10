import { describe, expect, it } from 'vitest';
import { compileScene, parseStoryFilter, STORY_FILTER_NAMES } from '../src/index.js';
describe('author story filter', () => {
  it('compiles every builtin, including off and explicit zero duration', () => {
    for (const name of STORY_FILTER_NAMES) {
      const scene = compileScene(`@filter ${name} 0`, 'intro.gal', 'intro');
      expect(scene.diagnostics).toEqual([]);
      expect(parseStoryFilter([name, '0'])).toEqual({ name, durationMs: 0 });
    }
    expect(parseStoryFilter(['blur'])).toEqual({ name: 'blur', durationMs: 0 });
  });
  it.each(['unknown', 'blur -1', 'blur Infinity', 'blur 600001', 'blur 1 extra'])('rejects %s before execution', args => {
    expect(() => compileScene(`@filter ${args}`, 'intro.gal', 'intro')).toThrowError(expect.objectContaining({ code: 'FILTER_INVALID' }));
  });
});
