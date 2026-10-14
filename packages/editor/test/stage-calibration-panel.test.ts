import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const draft = vi.hoisted(() => ({ text: '{"version":1}' }));
const projectState = vi.hoisted(() => ({ gameConfigText: '{}', dirHandle: {}, dirName: 'stage-test', dirAssets: [], pendingSceneCommit: null, projectLoading: false, reviewWorkspace: null, reviewPreviewReadOnly: false, projectWriteLock: null }));
const config = vi.hoisted(() => ({
  readStageConfigDraft: vi.fn(() => draft.text),
  editStageConfigDraft: vi.fn((text: string) => { draft.text = text; }),
  reloadStageConfigDraft: vi.fn(() => draft.text),
  saveStageConfigDraftUnlocked: vi.fn(async () => ({ text: '{}' })),
  configUndo: vi.fn(), configRedo: vi.fn(),
}));
vi.mock('../src/state.js', () => ({ state: projectState }));
vi.mock('../src/panels/config.js', () => config);
vi.mock('../src/project-io.js', () => ({ assetPathForHandle: vi.fn(), runProjectWriteOperation: (action: () => Promise<unknown>) => action() }));

import { createStageCalibrationPanel } from '../src/stage-calibration-panel.js';

type Control = {
  tag: string; textContent: string; value: string; isConnected: boolean;
  attrs: Record<string, string>; children: Control[];
  append(...children: Control[]): void; replaceChildren(...children: Control[]): void;
  setAttribute(name: string, value: string): void; closest(): null; getContext(): null;
  onclick?: () => void | Promise<void>;
};
let nodes: Control[];
beforeEach(() => {
  vi.clearAllMocks(); draft.text = '{"version":1}'; nodes = [];
  config.saveStageConfigDraftUnlocked.mockReset().mockResolvedValue({ text: '{}' });
  vi.stubGlobal('document', { createElement(tag: string) {
    const control: Control = { tag, textContent: '', value: '', isConnected: true, attrs: {}, children: [],
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this.attrs[name] = value; }, closest: () => null, getContext: () => null };
    nodes.push(control); return control;
  } });
});
afterEach(() => vi.unstubAllGlobals());
const input = (name: string) => nodes.find(node => node.attrs['aria-label'] === name)!;
const button = (label: string) => nodes.find(node => node.tag === 'button' && node.textContent === label)!;
const status = () => nodes.find(node => node.attrs.role === 'status')!;
async function click(label: string) { await button(label).onclick!(); await Promise.resolve(); }

describe('A027 stage calibration button error reporting', () => {
  it.each([
    ['加入位置草稿', '新舞台位置名称', '', '请填写位置名称。'],
    ['加入距离草稿', '新舞台距离名称', '', '请填写距离名称。'],
    ['加入距离草稿', '距离倍率', '-1', 'distances'],
  ])('reports synchronous validation for %s without editing the draft', async (label, name, value, message) => {
    createStageCalibrationPanel(vi.fn());
    input('新舞台位置名称').value = 'near-left'; input('新舞台距离名称').value = 'close';
    input(name).value = value;
    const original = draft.text;
    await expect(click(label)).resolves.toBeUndefined();
    expect(status().textContent).toContain(message); expect(draft.text).toBe(original);
    expect(config.editStageConfigDraft).not.toHaveBeenCalled();
  });

  it.each(['{broken', '{"version":2}', '[]'])('surfaces an invalid current stage draft %s', async text => {
    createStageCalibrationPanel(vi.fn()); draft.text = text;
    input('新舞台位置名称').value = 'near-left';
    await expect(click('加入位置草稿')).resolves.toBeUndefined();
    expect(status().textContent).not.toBe(''); expect(draft.text).toBe(text);
    expect(config.editStageConfigDraft).not.toHaveBeenCalled();
  });

  it.each(['position', 'distance'])('keeps a valid %s edit and the existing success status', async kind => {
    createStageCalibrationPanel(vi.fn());
    input('新舞台位置名称').value = 'near-left'; input('新舞台距离名称').value = 'close';
    await click(kind === 'position' ? '加入位置草稿' : '加入距离草稿');
    expect(config.editStageConfigDraft).toHaveBeenCalledOnce();
    expect(JSON.parse(draft.text)).toMatchObject(kind === 'position' ? { positions: { 'near-left': { x: 640, y: 720 } } } : { distances: { close: 1 } });
    expect(status().textContent).toContain('已加入配置草稿，尚未保存');
  });

  it('reports async save rejection, clears busy and allows a later successful save', async () => {
    const onSaved = vi.fn(); createStageCalibrationPanel(onSaved);
    config.saveStageConfigDraftUnlocked.mockRejectedValueOnce(new Error('保存失败测试'));
    await click('保存舞台配置'); await Promise.resolve();
    expect(status().textContent).toBe('保存失败测试'); expect(onSaved).not.toHaveBeenCalled();
    await click('保存舞台配置'); await Promise.resolve();
    expect(config.saveStageConfigDraftUnlocked).toHaveBeenCalledTimes(2); expect(onSaved).toHaveBeenCalledOnce();
    expect(status().textContent).toContain('已通过共享事务保存');
  });

  it('keeps readonly and disposed actions disabled', async () => {
    let editable = false;
    const panel = createStageCalibrationPanel(vi.fn(), () => editable);
    input('新舞台位置名称').value = 'near-left'; await click('加入位置草稿');
    editable = true; panel.dispose(); await click('加入位置草稿');
    expect(config.editStageConfigDraft).not.toHaveBeenCalled();
  });
});
