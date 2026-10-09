import { describe, expect, it } from 'vitest';
import {
  RECENT_PROJECT_LIMIT,
  findRecentProject,
  parseRecentProjects,
  recentProjectId,
  summarizeRecentProjects,
  withRecentProject,
} from '../desktop/recent-projects.js';

const entry = (projectPath: string, openedAt = 1) => ({ path: projectPath, name: projectPath.split(/[\\/]/).pop()!, openedAt });

describe('desktop recent projects', () => {
  it('moves a reopened project to the front without duplicating case variants', () => {
    const list = [entry('E:\\surdet\\examples\\starter', 1), entry('E:\\surdet\\games\\tide-mark', 2)];
    const next = withRecentProject(list, entry('e:\\SURDET\\games\\tide-mark', 3));
    expect(next.map((project) => project.openedAt)).toEqual([3, 1]);
    expect(next).toHaveLength(2);
  });

  it('keeps only the newest projects within the limit', () => {
    let list = [] as ReturnType<typeof parseRecentProjects>;
    for (let index = 0; index < RECENT_PROJECT_LIMIT + 3; index++) list = withRecentProject(list, entry(`/projects/${index}`, index));
    expect(list).toHaveLength(RECENT_PROJECT_LIMIT);
    expect(list[0]!.path).toBe(`/projects/${RECENT_PROJECT_LIMIT + 2}`);
  });

  it('drops malformed, duplicate and oversized stored entries instead of trusting the file', () => {
    const parsed = parseRecentProjects({ entries: [
      entry('/a', 1), { path: '/a', name: 'dup', openedAt: 2 }, { path: 42, name: 'x', openedAt: 1 },
      { path: '/b', name: 'b', openedAt: Number.NaN }, { path: 'x'.repeat(5000), name: 'long', openedAt: 1 }, null, entry('/c', 3),
    ] });
    expect(parsed.map((project) => project.path)).toEqual(['/a', '/c']);
    expect(parseRecentProjects(null)).toEqual([]);
    expect(parseRecentProjects({ entries: 'nope' })).toEqual([]);
  });

  it('resolves only ids derived from recorded directories, never a renderer path', () => {
    const list = [entry('/projects/starter'), entry('/projects/zero')];
    const [first] = summarizeRecentProjects(list);
    expect(first).toEqual({ id: recentProjectId('/projects/starter'), name: 'starter', location: '/projects/starter', openedAt: 1 });
    expect(findRecentProject(list, first!.id)?.path).toBe('/projects/starter');
    expect(findRecentProject(list, '/projects/starter')).toBeUndefined();
    expect(findRecentProject(list, recentProjectId('/etc'))).toBeUndefined();
    expect(findRecentProject(list, 7)).toBeUndefined();
  });
});
