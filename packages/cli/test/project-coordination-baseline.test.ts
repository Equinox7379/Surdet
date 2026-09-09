import { describe, expect, it } from 'vitest';
import {
  loadProjectCoordinationBaseline,
} from '../src/authoring/project-coordination-baseline.js';

const files = new Map<string, string>([
  ['game.config.json', '{"entryScene":"a"}\n'],
  ['content/config/gallery.json', '{"images":[]}\n'],
  ['content/scenario/a.gal', '@scene a\n@end\n'],
  ['content/timelines/a.json', '{"version":1,"id":"a","durationMs":0,"tracks":[]}\n'],
  ['content/assets/bg/a.png', 'not-real-binary'],
  ['README.md', 'ignored'],
]);

const storage = {
  rootIdentity: '/project',
  listFiles: async () => [...files.keys()],
  readText: async (path: string) => {
    const text = files.get(path)!;
    return {
      path,
      text,
      bytes: text.length,
      sha256: `${path}:${text}`,
    };
  },
};

describe('project coordination baseline', () => {
  it('covers all Editor-editable text without hashing asset bytes into every heartbeat', async () => {
    const first = await loadProjectCoordinationBaseline(storage as never, {
      sha256: async (text) => `hash:${text}`,
    });
    expect(first.files.map((file) => file.path)).toEqual([
      'content/config/gallery.json',
      'content/scenario/a.gal',
      'content/timelines/a.json',
      'game.config.json',
    ]);
    expect(first.files.some((file) => file.path.includes('assets'))).toBe(false);
  });

  it('moves coordination revision when a non-Authoring config changes', async () => {
    const first = await loadProjectCoordinationBaseline(storage as never, {
      sha256: async (text) => `hash:${text}`,
    });
    files.set('content/config/gallery.json', '{"images":["new"]}\n');
    const second = await loadProjectCoordinationBaseline(storage as never, {
      sha256: async (text) => `hash:${text}`,
    });
    expect(second.coordinationRevision).not.toBe(first.coordinationRevision);
  });
});
