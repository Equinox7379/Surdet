import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createGameExport, type GameExportBridge } from '../src/panels/game-export.js';
import type { ExportGameRequest } from '../desktop/contracts.js';

// Execute the runner's real-export-to-controlled-export statements, without launching
// Electron, exporting a game, or duplicating its wait/reset logic in this test.
const source = ts.createSourceFile('desktop-game-export.e2e.mjs', readFileSync(new URL('../e2e/desktop-game-export.e2e.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const body = source.statements.find(ts.isTryStatement)!.tryBlock.statements;
const clicks = body.flatMap((statement, index) => statement.getText(source) === 'await run.click();' ? [index] : []);
const phase = body.slice(clicks[0], clicks[1]! + 1).map(statement => statement.getText(source)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runPhase = new AsyncFunction('page', 'dialog', 'status', 'run', 'app', 'fs', 'exportParent', 'output', 'process', 'path', 'assert', 'console', 'plugin', phase);

describe('desktop export runner terminal outcome and next form', () => {
  it.each([true, false])('reaches the controlled export after real success=%s', async success => {
    const exportParent = 'D:\\exports\\real';
    const freshParent = 'D:\\exports\\controlled';
    const executable = path.join(exportParent, '导出验证-windows', '导出验证.exe');
    const requests: ExportGameRequest[] = [];
    let controlled = false;
    let location = exportParent;
    let grants = 0;
    const bridge: GameExportBridge = {
      inspectGameExport: vi.fn(async () => ({ id: 'export-check', title: '导出验证', version: '0.2.0', issues: [], plugins: [{ id: 'letters', entry: 'plugins/letters.js' }] })),
      chooseExportLocation: vi.fn(async () => ({ id: `location-${++grants}`, location })),
      exportGame: async request => {
        requests.push(request);
        if (!controlled && !success) throw new Error('test real export failure');
        const { title, version } = request;
        assert.ok(typeof title === 'string' && typeof version === 'string', 'this form supplies the export title and version');
        return { directory: path.dirname(executable), executable, id: 'export-check', title, version };
      },
      onGameExportProgress: () => () => {}, cancelGameExport: async () => {}, showGameExport: async () => {},
    };
    const exporter = createGameExport(bridge, { hasDrafts: () => false, save: async () => {}, busy: () => null, setExporting: () => {} }, () => {});
    await exporter.start(); exporter.setVersion('1.2.0'); exporter.setIcon('content/assets/ui/icon.png'); exporter.setAllowed('letters', true); await exporter.chooseLocation();
    function form(): void { assert.equal(exporter.state.stage, 'form', 'the form must be visible before using its controls'); }
    const dialog = {
      getByLabel: (name: string) => ({
        fill: async (value: string) => { form(); if (name === 'Windows 版本') exporter.setVersion(value); else if (name === '新文件夹名称') exporter.setFolderName(value); else throw new Error(name); },
        check: async () => { form(); exporter.setAllowed('letters', true); },
        selectOption: async (value: string) => { form(); exporter.setIcon(value); },
      }),
      getByRole: (_role: string, { name }: { name: string }) => ({ click: async () => {
        if (name === '再导出一份') { exporter.again(); await Promise.resolve(); }
        else if (name === '选择位置…') { form(); await exporter.chooseLocation(); }
        else throw new Error(name);
      } }),
      locator: (selector: string) => ({
        isVisible: async () => selector === '.game-export-form' ? exporter.state.stage === 'form' : exporter.state.stage === 'done',
        waitFor: async () => { if (selector === '.game-export-form') form(); },
        innerText: async () => exporter.state.location?.location ?? '尚未选择',
        getByText: (value: string) => ({ waitFor: async () => {
          if (selector === '.game-export-result') assert.equal(exporter.state.result?.executable, value);
          else assert.equal(exporter.state.location?.location ?? '尚未选择', value);
        } }),
      }),
    };
    const document = { querySelector: () => ({ querySelector: (selector: string) => selector === '.game-export-status'
      ? { textContent: exporter.state.message?.text ?? '' }
      : { hidden: selector === '.game-export-form' ? exporter.state.stage === 'done' : exporter.state.stage !== 'done' } }) };
    const page = {
      waitForFunction: async (predicate: () => unknown) => {
        vi.stubGlobal('document', document);
        try { assert.ok(predicate(), 'the terminal outcome must satisfy the runner wait'); }
        finally { vi.unstubAllGlobals(); }
      },
      evaluate: async () => ['checking'],
      locator: () => ({ isDisabled: async () => false }),
    };
    const app = { evaluate: async (_callback: unknown, folder?: string) => { if (folder) location = folder; else controlled = true; } };
    const disk = { readdir: async () => success ? ['导出验证-windows'] : [], stat: async () => ({ isFile: () => true }), mkdtemp: async () => freshParent };
    await runPhase(page, dialog, { innerText: async () => exporter.state.message?.text ?? '' },
      { click: async () => { form(); await exporter.exportGame(); } }, app, disk, exportParent, 'D:\\output', { platform: 'win32' }, path, assert, { log: () => {} }, dialog.getByLabel('允许把插件 letters 打包进游戏'));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ title: '导出验证', version: '1.2.0', folderName: '导出验证-正式', icon: 'content/assets/ui/icon.png', trustedPlugins: ['letters'] });
    expect(requests[1]!.locationId).toBe(success ? 'location-2' : 'location-1');
    expect(bridge.inspectGameExport).toHaveBeenCalledTimes(success ? 2 : 1);
    if (success) expect(location).toBe(freshParent);
  });
});
