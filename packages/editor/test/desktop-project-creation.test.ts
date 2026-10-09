import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopProject, selectProjectLocation } from '../desktop/project-creation.js';

const templates = fileURLToPath(new URL('../../cli/templates', import.meta.url));
const roots: string[] = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-desktop-create-'));
  roots.push(root);
  const parent = path.join(root, '中文 保存位置');
  fs.mkdirSync(parent);
  return { root, parent, location: selectProjectLocation(parent) };
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('surdet-desktop-create-')) throw new Error('unexpected fixture root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('desktop project creation', () => {
  it.each(['blank', 'example'] as const)('creates a complete independent %s project with Chinese title and local authoring guide', template => {
    const { parent, location } = fixture();
    const directory = createDesktopProject(location, { locationId: location.id, name: ' 春日 来信 ', template }, templates);
    expect(directory).toBe(path.join(parent, '春日 来信'));
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'game.config.json'), 'utf8'));
    expect(config.title).toBe('春日 来信');
    expect(config.entryScene).toBe(template === 'blank' ? 'start' : 'ch01_01');
    expect(fs.existsSync(path.join(directory, 'content/scenario', `${config.entryScene}.gal`))).toBe(true);
    expect(fs.existsSync(path.join(directory, 'AGENTS.md'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(directory, '.mcp.json.example'), 'utf8')).mcpServers.surdet.args).toContain('stage');
    const firstName = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).name;
    const second = createDesktopProject(location, { locationId: location.id, name: '另一份作品', template }, templates);
    expect(JSON.parse(fs.readFileSync(path.join(second, 'package.json'), 'utf8')).name).not.toBe(firstName);
    expect(fs.readdirSync(parent).sort()).toEqual(['另一份作品', '春日 来信'].sort());
  });

  it('refuses unselected, stale or arbitrary-path requests without creating files', () => {
    const { parent, location } = fixture();
    const valid = { locationId: location.id, name: '作品', template: 'blank' };
    expect(() => createDesktopProject(null, valid, templates)).toThrow('先选择');
    for (const request of [null, { ...valid, directory: parent }, { ...valid, locationId: 'another-window' }, { ...valid, template: 'other' },
      { ...valid, name: '../outside' }, { ...valid, name: 'CON.txt' }, { ...valid, name: 'a.' }, { ...valid, name: '' }]) {
      expect(() => createDesktopProject(location, request, templates)).toThrow();
    }
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it('does not overwrite an existing project and leaves no partial project after missing-template failure', () => {
    const { root, parent, location } = fixture();
    fs.mkdirSync(path.join(parent, '已有作品'));
    fs.writeFileSync(path.join(parent, '已有作品', 'keep.txt'), '作者原稿');
    expect(() => createDesktopProject(location, { locationId: location.id, name: '已有作品', template: 'blank' }, templates)).toThrow('已存在');
    expect(fs.readFileSync(path.join(parent, '已有作品', 'keep.txt'), 'utf8')).toBe('作者原稿');
    expect(() => createDesktopProject(location, { locationId: location.id, name: '缺模板', template: 'blank' }, path.join(root, 'missing-templates'))).toThrow('创建项目失败');
    expect(fs.readdirSync(parent)).toEqual(['已有作品']);
  });

  it('rejects a parent directory replaced after the native selection', () => {
    const { root, parent, location } = fixture();
    const moved = path.join(root, 'moved');
    expect(path.dirname(parent)).toBe(root);
    expect(path.dirname(moved)).toBe(root);
    fs.renameSync(parent, moved);
    fs.mkdirSync(parent);
    expect(() => createDesktopProject(location, { locationId: location.id, name: '作品', template: 'blank' }, templates)).toThrow('已被替换');
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(fs.readdirSync(moved)).toEqual([]);
  });
});
