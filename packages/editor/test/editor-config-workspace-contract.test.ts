import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relative: string): string => {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const configSource = source('../src/panels/config.ts');
const mapSource = source('../src/panels/calendar-map.ts');
const legacyCss = source('../src/styles.css');
const workspaceCss = source('../src/styles/config-workspace.css');
const indexHtml = source('../index.html');

describe('Frontend Pass 4 configuration ledger contract', () => {
  it('mounts one configuration workbench with eight stable Chinese sections', () => {
    expect(configSource).toContain("setAttribute('data-editor-panel', 'config')");
    expect(configSource).toContain("setAttribute('data-editor-region', 'config-workbench')");
    for (const id of ['characters', 'variables', 'achievements', 'calendar', 'growth', 'events', 'gallery', 'terminology']) {
      expect(configSource).toContain(`id: '${id}'`);
    }
    for (const label of ['角色', '变量', '成就', '日历与地图', '角色成长', '事件', '鉴赏', '名词表']) {
      expect(configSource).toContain(`label: '${label}'`);
    }
    expect(configSource).toContain("setAttribute('aria-current', 'page')");
    expect(configSource).toContain('panel.hidden = descriptor.id !== activeConfigSectionId');
  });

  it('separates human labels, technical names, tables and normal-flow actions', () => {
    expect(configSource).toContain('config-ledger-section');
    expect(configSource).toContain('config-technical-key');
    expect(configSource).toContain('显示技术名称');
    expect(configSource).toContain('config-table-scroll');
    expect(configSource).toContain('config-actions');
    expect(configSource).not.toContain("h('div', 'cfg-section')");
    expect(configSource).not.toContain("h('button', undefined, '✕')");
  });

  it('uses semantic calendar-map hooks without visible inline hex colors', () => {
    for (const className of [
      'config-map-arrow',
      'config-map-edge',
      'config-map-edge-preview',
      'config-map-node',
      'config-map-node-base',
      'config-map-node-overlap',
      'config-map-node-label',
      'config-map-node-meta',
      'config-map-node-port',
    ]) {
      expect(mapSource).toContain(className);
    }
    expect(mapSource).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(mapSource).toContain("setAttribute('role', 'img')");
    expect(mapSource).toContain("setAttribute('aria-label'");
  });

  it('loads a scoped, token-only configuration stylesheet and retires old config cards', () => {
    const ledgerSectionRule = workspaceCss.match(/#config-view \.config-ledger-section \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(indexHtml).toContain('<link rel="stylesheet" href="/src/styles/config-workspace.css" />');
    expect(workspaceCss).toContain('#config-view');
    expect(workspaceCss).toContain('--surdet-config-map-edge');
    expect(workspaceCss).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(workspaceCss).not.toMatch(/box-shadow|linear-gradient|border-left\s*:/i);
    expect(ledgerSectionRule).toContain('background-color: transparent');
    expect(ledgerSectionRule).not.toMatch(/border(?:-top|-bottom)?\s*:/i);
    expect(legacyCss).not.toContain('.cfg-section {');
    expect(legacyCss).not.toContain('.calendar-map-wrap {');
  });

  it('contains explicit compact and 200-percent-safe layout contracts', () => {
    expect(workspaceCss).toContain('@media (max-width: 800px)');
    expect(workspaceCss).toContain('overflow-x: auto');
    expect(workspaceCss).toContain('scrollbar-gutter: stable');
    expect(workspaceCss).toContain(':focus-visible');
    expect(workspaceCss).toContain('prefers-reduced-motion');
  });
});
