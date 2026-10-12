import { describe, expect, it, vi } from 'vitest';
import type { ExportGameInspection, ExportGameProgress, ExportGameRequest, ExportGameResult } from '../desktop/contracts.js';
import { createGameExport, gameExportBlocker, issueMessage, projectRelativeFile, type GameExportBridge, type GameExportHooks } from '../src/panels/game-export.js';

const inspection = (patch: Partial<ExportGameInspection> = {}): ExportGameInspection => ({
  id: 'harbor-letters', title: '雾港来信', version: '1.0.0', issues: [], plugins: [], ...patch,
});
const LOCATION = { id: 'loc-1', location: 'D:\\Games' };
const result: ExportGameResult = { directory: 'D:\\Games\\harbor', executable: 'D:\\Games\\harbor\\雾港来信.exe', id: 'harbor-letters', title: '雾港来信', version: '1.2.0' };

/** A bridge whose export settles only when the test says so, as the main process does. */
function fixture(options: { inspect?: () => Promise<ExportGameInspection>; drafts?: boolean[]; busy?: string | null } = {}) {
  let progress: ((value: ExportGameProgress) => void) | null = null;
  let settle: { resolve(value: ExportGameResult): void; reject(error: Error): void } | null = null;
  const unsubscribe = vi.fn(() => { progress = null; });
  const bridge = {
    inspectGameExport: vi.fn(options.inspect ?? (async () => inspection())),
    chooseExportLocation: vi.fn(async () => LOCATION),
    exportGame: vi.fn((_request: ExportGameRequest) => new Promise<ExportGameResult>((resolve, reject) => { settle = { resolve, reject }; })),
    cancelGameExport: vi.fn(async () => {}),
    showGameExport: vi.fn(async () => {}),
    onGameExportProgress: vi.fn((callback: (value: ExportGameProgress) => void) => { progress = callback; return unsubscribe; }),
  } satisfies GameExportBridge;
  const drafts = [...(options.drafts ?? [])];
  const exporting: boolean[] = [];
  const hooks: GameExportHooks = {
    hasDrafts: () => drafts.length > 1 ? drafts.shift()! : drafts[0] ?? false,
    save: vi.fn(async () => {}),
    busy: () => options.busy ?? null,
    setExporting: value => { exporting.push(value); },
  };
  const exporter = createGameExport(bridge, hooks, () => {});
  return { bridge, hooks, exporter, exporting, unsubscribe,
    emit: (value: ExportGameProgress) => progress?.(value), settle: () => settle! };
}
const ready = async (f: ReturnType<typeof fixture>) => {
  await f.exporter.start();
  await f.exporter.chooseLocation();
  return f.exporter;
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('before the export', () => {
  it('saves drafts first: the export reads only the saved project', async () => {
    const f = fixture({ drafts: [true, false] });
    await f.exporter.start();
    expect(f.exporter.state.stage).toBe('drafts');
    expect(f.bridge.inspectGameExport).not.toHaveBeenCalled();
    await f.exporter.saveAndContinue();
    expect(f.hooks.save).toHaveBeenCalledOnce();
    expect(f.exporter.state.stage).toBe('form');
  });
  it('stays on the drafts step when something is still unsaved after saving', async () => {
    const f = fixture({ drafts: [true, true] });
    await f.exporter.start();
    await f.exporter.saveAndContinue();
    expect(f.exporter.state).toMatchObject({ stage: 'drafts', message: { tone: 'error' } });
    expect(f.bridge.inspectGameExport).not.toHaveBeenCalled();
  });
  it('shows why the project cannot be inspected, without the Electron prefix', async () => {
    const f = fixture({ inspect: async () => { throw new Error("Error invoking remote method 'editor:export-inspect': Error: 项目改过src/main.ts，不能用通用入口导出。"); } });
    await f.exporter.start();
    expect(f.exporter.state).toMatchObject({ stage: 'unavailable', message: { text: '项目改过src/main.ts，不能用通用入口导出。', tone: 'error' } });
  });
});

describe('the inspection', () => {
  it('shows issue files relative to the project', () => {
    expect(projectRelativeFile('/home/a/src/games/harbor/content/scenario/ch01.gal')).toBe('content/scenario/ch01.gal');
    expect(projectRelativeFile('D:\\作品\\harbor\\plugins\\letters.ts')).toBe('plugins/letters.ts');
    expect(projectRelativeFile('content/scenario')).toBe('content/scenario');
    expect(projectRelativeFile('/home/a/harbor/game.config.json')).toBe('game.config.json');
    expect(projectRelativeFile('/elsewhere/file.txt')).toBe('/elsewhere/file.txt');
  });
  it('drops the location an issue text repeats at its start', () => {
    const file = '/home/a/harbor/content/scenario/ch01.gal';
    expect(issueMessage({ file, text: `${file}:3: 台词 speaker '凛' 不在 characters 中` })).toBe("台词 speaker '凛' 不在 characters 中");
    expect(issueMessage({ file: '/home/a/harbor/game.config.json', text: '/home/a/harbor/game.config.json: variables 为空' })).toBe('variables 为空');
    expect(issueMessage({ file, text: '项目没有可导出的场景。' })).toBe('项目没有可导出的场景。');
  });
});

describe('the form', () => {
  const base = { inspection: inspection(), title: '雾港来信', version: '1.0.0', folderName: 'out', location: LOCATION, allowed: new Set<string>() };
  it('names what is still missing, in order', () => {
    expect(gameExportBlocker(base)).toBeNull();
    expect(gameExportBlocker({ ...base, inspection: inspection({ issues: [{ severity: 'error', code: 'X', text: 't', file: 'f', line: 1, col: 1 }] }) })).toMatch(/1 个错误/);
    // A warning is shown but does not block.
    expect(gameExportBlocker({ ...base, inspection: inspection({ issues: [{ severity: 'warning', code: 'ASSET_UNUSED', text: 't', file: 'f', line: 0, col: 0 }] }) })).toBeNull();
    expect(gameExportBlocker({ ...base, title: '  ' })).toMatch(/标题/);
    expect(gameExportBlocker({ ...base, title: 'x'.repeat(201) })).toMatch(/标题/);
    for (const version of ['', '1.2', '1.2.3.4.5', '1.2.65536', '1.a.0', 'v1.0.0']) expect(gameExportBlocker({ ...base, version })).toMatch(/版本/);
    for (const version of ['0.0.0', '1.2.3', '65535.0.0.65535']) expect(gameExportBlocker({ ...base, version })).toBeNull();
    const plugins = inspection({ plugins: [{ id: 'letters', entry: 'plugins/letters.js' }, { id: 'notes', entry: 'plugins/notes.ts' }] });
    expect(gameExportBlocker({ ...base, inspection: plugins })).toBe('请逐个确认要打包的插件：letters、notes。');
    expect(gameExportBlocker({ ...base, inspection: plugins, allowed: new Set(['letters']) })).toBe('请逐个确认要打包的插件：notes。');
    expect(gameExportBlocker({ ...base, location: null })).toMatch(/导出位置/);
    expect(gameExportBlocker({ ...base, folderName: ' ' })).toMatch(/文件夹/);
    expect(gameExportBlocker({ ...base, folderName: 'a/b' })).toMatch(/不能包含路径/);
    expect(gameExportBlocker({ ...base, folderName: 'a\\b' })).toMatch(/不能包含路径/);
  });
  it('starts from the inspected title and version, and allows no plugin until the person checks it', async () => {
    const f = fixture({ inspect: async () => inspection({ version: '', plugins: [{ id: 'letters', entry: 'plugins/letters.js' }] }) });
    await f.exporter.start();
    expect(f.exporter.state).toMatchObject({ title: '雾港来信', version: '', folderName: 'harbor-letters-windows' });
    expect([...f.exporter.state.allowed]).toEqual([]);
    expect(f.exporter.state.message?.text).toMatch(/版本号/);
    f.exporter.setAllowed('letters', true);
    // Checking again re-reads the project and asks again.
    await f.exporter.recheck();
    expect([...f.exporter.state.allowed]).toEqual([]);
  });
  it('keeps the earlier location when the folder dialog is cancelled', async () => {
    const f = fixture();
    const exporter = await ready(f);
    f.bridge.chooseExportLocation.mockResolvedValueOnce(null as never);
    await exporter.chooseLocation();
    expect(exporter.state.location).toEqual(LOCATION);
  });
});

describe('the export', () => {
  it('sends only the location id, the form and the checked plugins, holding the Editor lock until it settles', async () => {
    const f = fixture({ inspect: async () => inspection({ plugins: [{ id: 'letters', entry: 'plugins/letters.js' }, { id: 'notes', entry: 'plugins/notes.js' }] }) });
    const exporter = await ready(f);
    exporter.setTitle(' 雾港来信 ');
    exporter.setVersion('1.2.0');
    exporter.setIcon('content/assets/ui/icon.png');
    exporter.setFolderName(' 雾港来信-正式 ');
    exporter.setAllowed('notes', true);
    exporter.setAllowed('letters', true);
    const running = exporter.exportGame();
    expect(f.bridge.exportGame).toHaveBeenCalledWith({ locationId: 'loc-1', folderName: '雾港来信-正式', title: '雾港来信', version: '1.2.0',
      icon: 'content/assets/ui/icon.png', trustedPlugins: ['letters', 'notes'] });
    expect(Object.keys(f.bridge.exportGame.mock.calls[0]![0])).not.toContain('encrypted');
    expect(f.exporting).toEqual([true]);
    expect(exporter.canClose()).toBe(false);
    f.emit({ phase: 'archive', completed: 3, total: 10 });
    expect(exporter.state.progress).toEqual({ phase: 'archive', completed: 3, total: 10 });
    f.settle().resolve(result);
    await running;
    expect(exporter.state).toMatchObject({ stage: 'done', result, location: null, message: { tone: 'success' } });
    expect(f.exporting).toEqual([true, false]);
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(exporter.canClose()).toBe(true);
  });
  it('leaves out the icon when none is chosen', async () => {
    const f = fixture();
    const exporter = await ready(f);
    void exporter.exportGame();
    expect(f.bridge.exportGame.mock.calls[0]![0]).toEqual({ locationId: 'loc-1', folderName: 'harbor-letters-windows', title: '雾港来信', version: '1.0.0', trustedPlugins: [] });
  });
  it('reports cancellation only after the export promise settled, and keeps the lock until then', async () => {
    const f = fixture();
    const exporter = await ready(f);
    const running = exporter.exportGame();
    await exporter.cancel();
    expect(f.bridge.cancelGameExport).toHaveBeenCalledOnce();
    expect(exporter.state.stage).toBe('cancelling');
    expect(exporter.state.message?.text).toMatch(/等待/);
    expect(f.exporting).toEqual([true]);
    expect(exporter.canClose()).toBe(false);
    await flush();
    expect(exporter.state.stage).toBe('cancelling');
    f.settle().reject(new Error("Error invoking remote method 'editor:export-game': Error: 导出已取消。"));
    await running;
    expect(exporter.state).toMatchObject({ stage: 'form', message: { text: '导出已取消。', tone: 'info' }, location: LOCATION });
    expect(f.exporting).toEqual([true, false]);
  });
  it('shows a finished export as finished even when a cancel was asked too late', async () => {
    const f = fixture();
    const exporter = await ready(f);
    const running = exporter.exportGame();
    await exporter.cancel();
    f.settle().resolve(result);
    await running;
    expect(exporter.state.stage).toBe('done');
  });
  it('keeps exporting when the cancel request itself fails', async () => {
    const f = fixture();
    const exporter = await ready(f);
    void exporter.exportGame();
    f.bridge.cancelGameExport.mockRejectedValueOnce(new Error('IPC down'));
    await exporter.cancel();
    expect(exporter.state).toMatchObject({ stage: 'exporting', message: { tone: 'error' } });
    expect(f.exporting).toEqual([true]);
  });
  it('keeps the form and location after a failed export, with the reason', async () => {
    const f = fixture();
    const exporter = await ready(f);
    const running = exporter.exportGame();
    f.settle().reject(new Error("Error invoking remote method 'editor:export-game': Error: 输出文件夹已存在；不会覆盖已有文件，请换一个文件夹名称。"));
    await running;
    expect(exporter.state).toMatchObject({ stage: 'form', location: LOCATION,
      message: { text: '导出没有完成：输出文件夹已存在；不会覆盖已有文件，请换一个文件夹名称。', tone: 'error' } });
  });
  it('does not start while another Editor operation is busy, or when drafts appeared after the check', async () => {
    const busy = fixture({ busy: '项目正在保存' });
    await (await ready(busy)).exportGame();
    expect(busy.bridge.exportGame).not.toHaveBeenCalled();
    expect(busy.exporter.state.message).toEqual({ text: '项目正在保存', tone: 'error' });
    const drafts = fixture({ drafts: [false, true] });
    await (await ready(drafts)).exportGame();
    expect(drafts.bridge.exportGame).not.toHaveBeenCalled();
    expect(drafts.exporter.state.stage).toBe('drafts');
  });
  it('does not undo a finished export when the folder cannot be shown', async () => {
    const f = fixture();
    const exporter = await ready(f);
    const running = exporter.exportGame();
    f.settle().resolve(result);
    await running;
    f.bridge.showGameExport.mockRejectedValueOnce(new Error('no shell'));
    await exporter.showResult();
    expect(exporter.state).toMatchObject({ stage: 'done', result, message: { tone: 'error', text: expect.stringMatching(/^成品已导出/) } });
  });
});
