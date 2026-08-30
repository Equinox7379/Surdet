import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.resolve(testDir, '..');
const read = (relative: string): string => {
  const absolute = path.join(editorRoot, relative);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
};

const html = read('index.html');
const legacy = read('src/styles.css');
const workspace = read('src/styles/timeline-workspace.css');
const panel = read('src/panels/timeline-panel.ts');

describe('Frontend Pass 3B Timeline Desk contract', () => {
  it('loads a dedicated Timeline stylesheet after shared Script and Flow layers', () => {
    expect(workspace.length).toBeGreaterThan(1000);
    const scriptIndex = html.indexOf('/src/styles/script-workspace.css');
    const flowIndex = html.indexOf('/src/styles/flow-workspace.css');
    const timelineIndex = html.indexOf('/src/styles/timeline-workspace.css');
    expect(scriptIndex).toBeGreaterThan(-1);
    expect(flowIndex).toBeGreaterThan(scriptIndex);
    expect(timelineIndex).toBeGreaterThan(flowIndex);
    expect(legacy).not.toMatch(/\.timeline-shell\s*\{/);
  });

  it('mounts one semantic full-page production desk with no compact duplicate', () => {
    for (const region of [
      'timeline-workbench',
      'timeline-library',
      'timeline-header',
      'timeline-toolbar',
      'timeline-ruler',
      'timeline-tracks',
      'timeline-inspector',
      'timeline-recovery',
    ]) {
      expect(panel).toContain(region);
    }
    expect(panel).toContain("setAttribute('data-editor-panel', 'timeline')");
    expect(panel).not.toContain('timeline-compact');
  });

  it('uses full selected surfaces and keyboard focus without colored selection rails', () => {
    expect(workspace).toMatch(/\.timeline-item\[aria-current=['"]true['"]\]/);
    expect(workspace).toMatch(/:focus-visible/);
    expect(workspace).not.toMatch(/inset\s+3px\s+0/);
    expect(workspace).not.toMatch(/border-left:\s*[2-9]px\s+solid/);
    expect(workspace).not.toMatch(/linear-gradient|radial-gradient/);
  });

  it('keeps primary actions in normal flow and provides 1024/800/720 responsive budgets', () => {
    expect(workspace).toMatch(/@media\s*\(max-width:\s*1024px\)/);
    expect(workspace).toMatch(/@media\s*\(max-width:\s*800px\)/);
    expect(workspace).toMatch(/@media\s*\(max-width:\s*720px\)/);
    expect(workspace).not.toMatch(/\.timeline-header-actions[^}]*position:\s*(fixed|sticky)/s);
    expect(workspace).toContain('overflow-x: auto');
  });
});
