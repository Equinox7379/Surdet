import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoringOperationError, getCapabilityDefinition } from '@surdet/authoring';
import { parseAgentPortArgs } from '../src/agent-port/args.js';
import { allowedCapabilitiesForPolicy } from '../src/agent-port/policy.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { PreviewContentService } from '../src/authoring/preview-content-service.js';
import { ProjectAssetRelocationAuthority, AssetRelocationInjectedTermination } from '../src/asset-import-authority/asset-relocation-authority.js';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import {
  openAgentPortSession,
  type AgentPortSession,
} from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-port-${name}-`));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

function projectBytes(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0 ? entry.name : path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) result.set(relative, fs.readFileSync(absolute, 'utf8'));
    }
  };
  walk(root, '');
  return result;
}

function dataBytes(root: string): Map<string, string> {
  if (!fs.existsSync(root)) return new Map();
  return projectBytes(root);
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthoringOperationError);
    expect((error as AuthoringOperationError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

function expectFailure(value: any, code: string): void {
  expect(value.ok).toBe(false);
  expect(value.error.code).toBe(code);
}

async function open(root: string, data: string, policy: 'observe' | 'stage' | 'apply', resumeChangeId?: string): Promise<AgentPortSession> {
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  return openAgentPortSession({ projectRoot: root, policy, ...(resumeChangeId === undefined ? {} : { resumeChangeId }) });
}

async function setTerminalOrStaleStatus(
  changeId: string,
  status: 'STALE' | 'COMMITTED' | 'ROLLED_BACK',
): Promise<void> {
  await NodeChangeStore.withChangeLease(changeId, async (leasedStore) => {
    const record = await leasedStore.read(changeId);
    if (record === null) throw new Error(`missing change ${changeId}`);
    await leasedStore.write({
      ...record,
      status,
      recordVersion: record.recordVersion + 1,
    }, {
      expectedRecordVersion: record.recordVersion,
      expectedStatus: record.status,
    });
  });
}

describe('Surdet Agent Port session and policy contract', () => {
  it('U1 public UI edits read actual image bounds, preserve rejected records and distinguish working from project', async () => {
    const root = makeProject('ui-style');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-style-data-')); temporaryRoots.push(data);
    fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
    const imagePath = path.join(root, 'content/assets/bg/纸框.svg');
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>';
    fs.writeFileSync(imagePath, image);
    const source = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
    const session = await open(root, data, 'apply');
    const invoke = async (capability: Parameters<typeof session.invoke>[0], input: Record<string, unknown>) => {
      const response = await session.invoke(capability, input);
      expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
      if (!response.ok) throw new Error(response.error.message);
      return response.result as any;
    };
    try {
      await invoke('change.begin', {});
      const initial = await invoke('project.ui', { view: 'working' });
      const rootNode = { id: 'panel', type: 'container', frame: { x: 0, y: 0, width: 400, height: 200 }, style: {
        opacity: 0, backgroundOpacity: 0, fontWeight: 700, letterSpacing: 0,
        backgroundImage: { asset: '纸框', fit: 'stretch', slice: { top: 10, right: 10, bottom: 10, left: 10, fillCenter: true } },
      } };
      const request = { operationId: crypto.randomUUID(), expectedFingerprint: initial.fingerprint, patch: { type: 'page.set', page: 'title', root: rootNode } };
      const changed = await invoke('project.ui.patch', request);
      expect(changed.ui.nodes[0].effectiveStyle).toMatchObject({ opacity: 0, backgroundOpacity: 0, fontWeight: 700 });
      expect((await invoke('project.ui', { view: 'project' })).value).toBeNull();
      expect((await invoke('project.ui', { view: 'working' })).value.pages.title).toEqual(rootNode);
      expectFailure(await session.invoke('project.ui.patch', { ...request, operationId: crypto.randomUUID() }), 'OBJECT_REF_STALE');
      const before = await invoke('project.ui', { view: 'working' });
      const oversized = structuredClone(rootNode); oversized.style.backgroundImage.slice.left = 90;
      expectFailure(await session.invoke('project.ui.patch', { ...request, operationId: crypto.randomUUID(), expectedFingerprint: before.fingerprint,
        patch: { ...request.patch, root: oversized } }), 'UI_INVALID');
      expect(await invoke('project.ui', { view: 'working' })).toEqual(before);
      expect((await invoke('project.validate', {})).ok).toBe(true);
      fs.writeFileSync(imagePath, '<svg width="10" height="10"/>');
      const invalid = await invoke('project.validate', {});
      expect(invalid.ok).toBe(false);
      expect(invalid.issues.some((issue: any) => issue.code === 'UI_INVALID' && issue.text.includes('九宫格'))).toBe(true);
      fs.writeFileSync(imagePath, image);
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(source);
    } finally { await session.close(); }
  });
  it('U1 merged layout fields survive public page, insert and update operations with effective defaults', async () => {
    const root = makeProject('ui-layout');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-layout-data-')); temporaryRoots.push(data);
    fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'content/assets/bg/art.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>');
    const session = await open(root, data, 'apply');
    const invoke = async (capability: Parameters<typeof session.invoke>[0], input: Record<string, unknown>) => {
      const response = await session.invoke(capability, input);
      expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
      if (!response.ok) throw new Error(response.error.message);
      return response.result as any;
    };
    const patch = async (value: Record<string, unknown>) => {
      const current = await invoke('project.ui', { view: 'working' });
      return invoke('project.ui.patch', { operationId: crypto.randomUUID(), expectedFingerprint: current.fingerprint, patch: value });
    };
    try {
      await invoke('change.begin', {});
      const page = await patch({ type: 'page.set', page: 'gallery', root: {
        id: 'rows', type: 'content', source: 'gallery-cgs', frame: { x: 0, y: 0, width: 400, height: 200 },
        style: { columns: 2, borderRadius: 8 },
      } });
      expect(page.ui.nodes[0].effectiveStyle).toMatchObject({ columns: 2, borderRadius: 8 });
      const inserted = await patch({ type: 'node.insert', page: 'gallery', parentId: 'rows', index: 0, node: {
        id: 'art', type: 'image', asset: 'art', frame: { x: 0, y: 0, width: 80, height: 60 }, style: { imageFit: 'cover' },
      } });
      expect(inserted.ui.nodes[1].effectiveStyle).toMatchObject({ imageFit: 'cover' });
      await patch({ type: 'node.update', page: 'gallery', id: 'art', patch: { style: { imageFit: 'fill' } } });
      const selected = await invoke('project.ui', { view: 'working' });
      expect(selected.nodes[1].effectiveStyle).toMatchObject({ imageFit: 'fill' });
      expect(selected.value.pages.gallery.children[0].style.imageFit).toBe('fill');
      for (const [id, style] of [['rows', { columns: 3 }], ['art', { imageFit: 'stretch' }]] as const) {
        expectFailure(await session.invoke('project.ui.patch', { operationId: crypto.randomUUID(), expectedFingerprint: selected.fingerprint,
          patch: { type: 'node.update', page: 'gallery', id, patch: { style } } }), 'INVALID_REQUEST');
      }
      expect((await invoke('project.ui', { view: 'working' })).value).toEqual(selected.value);
      await patch({ type: 'node.update', page: 'gallery', id: 'rows', patch: { style: { borderRadius: 8 } } });
      await patch({ type: 'node.update', page: 'gallery', id: 'art', patch: { style: null } });
      const inherited = await invoke('project.ui', { view: 'working' });
      expect(inherited.nodes[0].effectiveStyle).toMatchObject({ columns: 1 });
      expect(inherited.nodes[1].effectiveStyle).toMatchObject({ imageFit: 'contain' });
      expect((await invoke('project.ui', { view: 'project' })).value).toBeNull();
    } finally { await session.close(); }
  });
  it('U2 public page, insert and update operations preserve authored states and expose single-state and motion results', async () => {
    const root = makeProject('ui-interaction');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-interaction-data-')); temporaryRoots.push(data);
    const source = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
    const session = await open(root, data, 'apply');
    const invoke = async (capability: Parameters<typeof session.invoke>[0], input: Record<string, unknown>) => {
      const response = await session.invoke(capability, input);
      expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
      if (!response.ok) throw new Error(response.error.message);
      return response.result as any;
    };
    const patch = async (value: Record<string, unknown>) => {
      const current = await invoke('project.ui', { view: 'working' });
      return invoke('project.ui.patch', { operationId: crypto.randomUUID(), expectedFingerprint: current.fingerprint, patch: value });
    };
    try {
      await invoke('change.begin', {});
      const frame = { x: 0, y: 0, width: 400, height: 200 };
      const title = { id: 'title-button', type: 'button', frame, style: {
        color: 7, background: 8, opacity: 0.8, backgroundOpacity: 0.6,
        backgroundGradient: { from: 1, to: 2, angle: 90 }, textShadows: [{ x: 1, y: 1, blur: 2, color: 0, opacity: 1 }],
      }, states: {
        hover: { color: 0, opacity: 0, backgroundOpacity: 0, backgroundGradient: null, backgroundImage: null, textShadows: [], shadows: [] },
        focus: { color: 9 }, pressed: { color: 10 }, disabled: { color: 11, opacity: 0.4 },
      }, transition: { enter: { durationMs: 250 }, exit: { durationMs: 0, opacity: 0 } } };
      const page = await patch({ type: 'page.set', page: 'title', root: title });
      expect(page.ui.value).toEqual({ version: 1, pages: { title } });
      expect(page.ui.nodes[0].effectiveStyle).toMatchObject({ color: 7, opacity: 0.8, backgroundOpacity: 0.6 });
      expect(page.ui.nodes[0].effectiveStates).toMatchObject({
        hover: { color: 0, opacity: 0, backgroundOpacity: 0, backgroundGradient: null, backgroundImage: null, textShadows: [], shadows: [] },
        focus: { color: 9, opacity: 0.8, backgroundOpacity: 0.6, backgroundGradient: title.style.backgroundGradient },
        pressed: { color: 10, opacity: 0.8, backgroundOpacity: 0.6 }, disabled: { color: 11, opacity: 0.4 * 0.45 },
      });
      expect(page.ui.nodes[0].effectiveTransition).toEqual({
        enter: { durationMs: 250, opacity: 1, x: 0, y: 0, scale: 1, easing: 'ease-out' }, exit: null,
      });
      expect((await invoke('project.ui', { view: 'working' })).value.pages.title).toEqual(title);

      const panel = { id: 'panel', type: 'container', frame };
      const plain = await patch({ type: 'page.set', page: 'settings', root: panel });
      const panelView = plain.ui.nodes.find((entry: any) => entry.id === 'panel');
      expect(panelView.effectiveTransition).toEqual({ enter: null, exit: null });
      expect(panelView).not.toHaveProperty('effectiveStates');
      const button = { id: 'child', type: 'button', frame, style: { color: 12, opacity: 0.6 }, states: {
        hover: { color: 0 }, focus: { opacity: 0 }, pressed: { background: 0 }, disabled: {},
      } };
      const inserted = await patch({ type: 'node.insert', page: 'settings', parentId: 'panel', index: 0, node: button });
      expect(inserted.ui.value.pages.settings).toEqual({ ...panel, children: [button] });
      const childView = inserted.ui.nodes.find((entry: any) => entry.id === 'child');
      expect(childView.effectiveStates).toMatchObject({ hover: { color: 0, opacity: 0.6 }, focus: { color: 12, opacity: 0 },
        pressed: { color: 12, background: 0, opacity: 0.6 }, disabled: { color: 12, opacity: 0.6 * 0.45 } });
      expect(childView).not.toHaveProperty('effectiveTransition');

      const states = { hover: { background: 0 }, focus: { color: 0 }, pressed: { opacity: 0 }, disabled: { opacity: 0 } };
      const transition = { enter: { durationMs: 200, opacity: 0, x: 0, y: 0, scale: 1, easing: 'linear' },
        exit: { durationMs: 300, opacity: 0.2, x: -8, y: 16, scale: 0.9, easing: 'ease-in-out' } };
      const updated = await patch({ type: 'node.update', page: 'title', id: title.id, patch: { states, transition } });
      const updatedView = updated.ui.nodes.find((entry: any) => entry.id === title.id);
      expect(updated.ui.value.pages.title).toEqual({ ...title, states, transition });
      expect(updatedView.effectiveStates).toMatchObject({ hover: { color: 7, background: 0, opacity: 0.8 }, focus: { color: 0, opacity: 0.8 },
        pressed: { color: 7, opacity: 0 }, disabled: { color: 7, opacity: 0 } });
      expect(updatedView.effectiveTransition).toEqual(transition);
      const selected = await invoke('project.ui', { view: 'working' });
      expect(selected.value).toEqual(updated.ui.value);
      expect(selected.nodes).toEqual(updated.ui.nodes);

      await patch({ type: 'node.update', page: 'title', id: title.id, patch: { states: null, transition: null } });
      await patch({ type: 'node.update', page: 'settings', id: button.id, patch: { states: null } });
      const cleared = await invoke('project.ui', { view: 'working' });
      expect(cleared.value.pages.title).toEqual({ id: title.id, type: title.type, frame, style: title.style });
      expect(cleared.value.pages.settings.children[0]).toEqual({ id: button.id, type: button.type, frame, style: button.style });
      for (const id of [title.id, button.id]) {
        const inspected = cleared.nodes.find((entry: any) => entry.id === id);
        for (const state of ['hover', 'focus', 'pressed']) expect(inspected.effectiveStates[state]).toEqual(inspected.effectiveStyle);
        expect(inspected.effectiveStates.disabled).toEqual({ ...inspected.effectiveStyle, opacity: inspected.effectiveStyle.opacity * 0.45 });
      }
      expect(cleared.nodes.find((entry: any) => entry.id === title.id).effectiveTransition).toEqual({ enter: null, exit: null });
      expect((await invoke('project.ui', { view: 'project' })).value).toBeNull();
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(source);
    } finally { await session.close(); }
  });
  it('U2 hover image dependencies use real SVG bounds and invalid state or transition writes leave working value unchanged', async () => {
    const root = makeProject('ui-interaction-assets');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-interaction-assets-data-')); temporaryRoots.push(data);
    fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
    const imagePath = path.join(root, 'content/assets/bg/hover.svg');
    fs.writeFileSync(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"/>');
    const source = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
    const session = await open(root, data, 'apply');
    const invoke = async (capability: Parameters<typeof session.invoke>[0], input: Record<string, unknown>) => {
      const response = await session.invoke(capability, input);
      expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
      if (!response.ok) throw new Error(response.error.message);
      return response.result as any;
    };
    const patch = async (value: Record<string, unknown>) => {
      const current = await invoke('project.ui', { view: 'working' });
      return invoke('project.ui.patch', { operationId: crypto.randomUUID(), expectedFingerprint: current.fingerprint, patch: value });
    };
    const reject = async (value: Record<string, unknown>, code: string, message?: string) => {
      const before = await invoke('project.ui', { view: 'working' });
      const response = await session.invoke('project.ui.patch', { operationId: crypto.randomUUID(), expectedFingerprint: before.fingerprint, patch: value });
      expectFailure(response, code);
      if (message) {
        if (response.ok) throw new Error('expected rejected UI patch');
        expect(response.error.message).toContain(message);
      }
      expect((await invoke('project.ui', { view: 'working' })).value).toEqual(before.value);
    };
    try {
      await invoke('change.begin', {});
      const frame = { x: 0, y: 0, width: 400, height: 200 };
      const panel = { id: 'panel', type: 'container', frame };
      await patch({ type: 'page.set', page: 'title', root: panel });
      const button = { id: 'hover-button', type: 'button', frame, states: { hover: { backgroundImage: {
        asset: 'hover', fit: 'stretch', slice: { top: 4, right: 12, bottom: 4, left: 12, fillCenter: true },
      } } } };
      const insert = { type: 'node.insert', page: 'title', parentId: panel.id, index: 0, node: button };
      await reject(insert, 'UI_INVALID', '九宫格');
      fs.writeFileSync(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>');
      const inserted = await patch(insert);
      expect(inserted.ui.value.pages.title).toEqual({ ...panel, children: [button] });
      expect(inserted.ui.nodes.find((entry: any) => entry.id === button.id).effectiveStates.hover.backgroundImage)
        .toEqual(button.states.hover.backgroundImage);
      const assets = await invoke('project.assets', { view: 'working' });
      expect(assets.backgrounds).toContainEqual(expect.objectContaining({ key: 'hover', resolved: true }));
      expect(assets.intelligence.items.find((item: any) => item.kind === 'background' && item.key === 'hover')?.references)
        .toContainEqual(expect.objectContaining({ referenceId: `ui:${button.id}:states:hover:backgroundImage:asset`,
          sourceKind: 'config', sourcePath: 'game.config.json', objectRef: `ui:${button.id}` }));
      const uiObject = await invoke('object.inspect', { view: 'working', objectRef: `ui:${button.id}` });
      expect(uiObject.references).toContain('asset:bg:hover');
      const imageObject = await invoke('object.inspect', { view: 'working', objectRef: 'asset:bg:hover' });
      expect(imageObject.referencedBy).toContain(`ui:${button.id}`);
      await reject({ type: 'node.update', page: 'title', id: button.id,
        patch: { states: { hover: { backgroundImage: { asset: 'missing-hover', fit: 'cover' } } } } }, 'UI_INVALID', 'missing-hover');

      for (const stateStyle of [{ fontSize: 18 }, { padding: { top: 1, right: 1, bottom: 1, left: 1 } },
        { action: { kind: 'start' } }, { visibleWhen: 'true' }, { css: 'outline:none' }]) {
        await reject({ type: 'node.update', page: 'title', id: button.id, patch: { states: { hover: stateStyle } } }, 'INVALID_REQUEST');
      }
      await reject({ type: 'node.update', page: 'title', id: panel.id, patch: { states: { focus: { color: 0 } } } }, 'UI_INVALID');
      const transition = { enter: { durationMs: 100, opacity: 0 } };
      await reject({ ...insert, node: { ...button, id: 'nested-motion', transition } }, 'UI_INVALID');
      await reject({ type: 'node.update', page: 'title', id: button.id, patch: { transition } }, 'UI_INVALID');
      await reject({ type: 'page.set', page: 'title', root: { ...panel, children: [{ ...button, transition }] } }, 'UI_INVALID');

      for (const field of ['states', 'transition']) {
        await reject({ type: 'page.set', page: 'title', root: { ...panel, type: 'button', [field]: null } }, 'INVALID_REQUEST');
        await reject({ ...insert, node: { ...button, id: 'stored-null', [field]: null } }, 'INVALID_REQUEST');
        await reject({ type: 'page.set', page: 'title', root: { ...panel, children: [{ ...button, [field]: null }] } }, 'UI_INVALID');
      }
      await reject({ type: 'node.update', page: 'title', id: button.id, patch: { states: { hover: null } } }, 'INVALID_REQUEST');
      await reject({ type: 'node.update', page: 'title', id: panel.id, patch: { transition: { enter: null } } }, 'INVALID_REQUEST');
      expect((await invoke('project.ui', { view: 'working' })).value).toEqual(inserted.ui.value);
      expect((await invoke('project.ui', { view: 'project' })).value).toBeNull();
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(source);
    } finally { await session.close(); }
  });
  it('U2 asset relocation rewrites every state image without rewriting state or motion metadata', async () => {
    const root = makeProject('ui-state-relocation');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-state-relocation-')); temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>';
    fs.writeFileSync(path.join(root, 'content/assets/bg/hover.svg'), image);
    const configPath = path.join(root, 'game.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.ui = { version: 1, pages: { title: { id: 'hover', type: 'button', frame: { x: 0, y: 0, width: 200, height: 60 },
      text: { kind: 'literal', value: 'hover' }, transition: { enter: { durationMs: 100, easing: 'linear' } },
      states: { hover: { backgroundImage: { asset: 'hover', fit: 'cover' } },
        disabled: { backgroundImage: { asset: 'hover', fit: 'stretch', slice: { top: 10, right: 10, bottom: 10, left: 10, fillCenter: true } } } },
    } } };
    fs.writeFileSync(configPath, JSON.stringify(config));
    const session = await openAgentPortSession({ projectRoot: root, policy: 'apply', assetImportDataRoot: path.join(data, 'assets') });
    const invoke = async (capability: Parameters<typeof session.invoke>[0], input: Record<string, unknown>) => {
      const response = await session.invoke(capability, input);
      expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
      if (!response.ok) throw new Error(response.error.message);
      return response.result as any;
    };
    try {
      const operationId = crypto.randomUUID();
      const plan = await invoke('asset.relocation.plan', { operationId, moves: [{ sourcePath: 'content/assets/bg/hover.svg', targetPath: 'content/assets/bg/selected.svg' }] });
      await invoke('asset.relocation.commit', { operationId, planFingerprint: plan.plan.planFingerprint });
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const expected = structuredClone(config);
      expected.ui.pages.title.states.hover.backgroundImage.asset = 'selected';
      expected.ui.pages.title.states.disabled.backgroundImage.asset = 'selected';
      expect(saved).toEqual(expected);
      expect(fs.readFileSync(path.join(root, 'content/assets/bg/selected.svg'), 'utf8')).toBe(image);
      expect(fs.existsSync(path.join(root, 'content/assets/bg/hover.svg'))).toBe(false);
      const ui = await invoke('project.ui', { view: 'project' });
      expect(ui.nodes[0].effectiveStates.hover.backgroundImage.asset).toBe('selected');
      expect(ui.nodes[0].effectiveStates.disabled.backgroundImage.asset).toBe('selected');
    } finally { await session.close(); }
  });
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['resume', 'rollback'] as const)('describes a truly resolved relocation barrier after %s and still blocks corrupt evidence', async action => {
    const root = makeProject(`relocation-description-${action}`);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-relocation-description-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    const assetData = path.join(data, 'asset-records');
    const canonicalRoot = fs.realpathSync(root);
    fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'content/assets/bg/old.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const session = await openAgentPortSession({ projectRoot: root, policy: 'apply', assetImportDataRoot: assetData });
    const invoke = async (capability: Parameters<typeof session.invoke>[0], input: Record<string, unknown>) => {
      const response = await session.invoke(capability, input);
      expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
      if (!response.ok) throw new Error(response.error.message);
      return response.result as any;
    };
    const operationId = crypto.randomUUID();
    const faultPort = ProjectAssetRelocationAuthority.prototype as unknown as { fault(point: string): Promise<void> };
    const original = faultPort.fault;
    let stopped = false;
    const injected = vi.spyOn(faultPort, 'fault').mockImplementation(async function (this: ProjectAssetRelocationAuthority, point) {
      if (this.paths.projectRoot === canonicalRoot && point === 'after_target_link_before_journal' && !stopped) {
        stopped = true;
        throw new AssetRelocationInjectedTermination('after_target_link_before_journal');
      }
      return original.call(this, point);
    });
    try {
      const plan = await invoke('asset.relocation.plan', { operationId, moves: [{ sourcePath: 'content/assets/bg/old.svg', targetPath: 'content/assets/bg/new.svg' }] });
      const request = { operationId, planFingerprint: plan.plan.planFingerprint };
      expect(await session.invoke('asset.relocation.commit', request)).toMatchObject({ ok: false, error: { code: 'IMPORT_IO_FAILED' } });
      expect(stopped).toBe(true);
      expect((await invoke('asset.relocation.inspect', { operationId })).operation.status).toBe('PUBLISHING');
      expect((await session.describe()).manualRecoveryRequired).toBe(true);
      const result = await invoke('asset.relocation.recover', { ...request, action });
      expect(result.operation.status).toBe(action === 'resume' ? 'COMMITTED' : 'ROLLED_BACK');
      const before = projectBytes(root);
      const description = await session.describe();
      expect(description.manualRecoveryRequired).toBe(false);
      expect(description.recoveryDisposition).toBe('NO_ACTION');
      expect(description.capabilities.find(capability => capability.id === 'asset.relocation.plan')?.availability).toBe('available');
      const paths = await openAssetImportAuthorityPaths({ projectRoot: root, dataRoot: assetData });
      const resolution = path.join(paths.projectNamespace, 'recovery-resolutions', fs.readdirSync(path.join(paths.projectNamespace, 'recovery-resolutions'))[0]!);
      const resolutionBytes = fs.readFileSync(resolution, 'utf8');
      fs.writeFileSync(resolution, JSON.stringify({ ...JSON.parse(resolutionBytes), incidentSha256: '0'.repeat(64) }));
      expect((await session.describe()).manualRecoveryRequired).toBe(true);
      fs.writeFileSync(resolution, resolutionBytes);
      const recordFile = path.join(paths.projectNamespace, 'relocations', operationId, 'record.json');
      const recordBytes = fs.readFileSync(recordFile, 'utf8');
      const invalidTerminal = JSON.parse(recordBytes);
      invalidTerminal.journal.binaryState = action === 'resume' ? 'BACKUP' : 'TARGET';
      invalidTerminal.journal.binaryItems[0].state = invalidTerminal.journal.binaryState;
      const invalidBytes = JSON.stringify(invalidTerminal);
      fs.writeFileSync(recordFile, invalidBytes);
      expect((await session.describe()).manualRecoveryRequired).toBe(true);
      expect(fs.readFileSync(recordFile, 'utf8')).toBe(invalidBytes);
      fs.writeFileSync(recordFile, recordBytes);
      expect((await session.describe()).manualRecoveryRequired).toBe(false);
      expect(projectBytes(root)).toEqual(before);
    } finally { injected.mockRestore(); await session.close(); }
  }, 30_000);

  it('requires explicit project and immutable policy', () => {
    expectCode(() => parseAgentPortArgs([]), 'INVALID_REQUEST');
    expectCode(() => parseAgentPortArgs(['--project', 'x', '--policy', 'observe', '--unknown']), 'INVALID_REQUEST');
    expectCode(() => parseAgentPortArgs(['--project', 'x', '--policy', 'observe', '--policy', 'stage']), 'INVALID_REQUEST');
    expectCode(() => parseAgentPortArgs(['--project', 'x', '--policy', 'observe', '--contract-version', '0.9.0']), 'CONTRACT_VERSION_UNSUPPORTED');
    expectCode(() => parseAgentPortArgs(['--project', 'x', '--policy', 'observe', '--contract-version', '2.1.0']), 'CONTRACT_VERSION_UNSUPPORTED');
    expect(allowedCapabilitiesForPolicy('observe')).toContain('project.inspect');
    expect(allowedCapabilitiesForPolicy('observe')).not.toContain('change.begin');
  });

  it('resumes an ordinary direct stage draft without granting source writes or candidate eligibility', async () => {
    const root = makeProject('direct-stage');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-direct-stage-'));
    temporaryRoots.push(data);
    const original = projectBytes(root);
    let session = await open(root, data, 'stage');
    try {
      const begun = await session.invoke('change.begin', { compositionMode: 'direct', intent: 'ordinary chapter' });
      expect(begun, JSON.stringify(begun)).toMatchObject({ ok: true, result: { compositionMode: 'direct' } });
      const changeId = session.activeChangeId!;
      expect((await session.invoke('variable.ensure', { operationId: 'visited', name: 'visited', type: 'flag', initial: false })).ok).toBe(true);
      expect((await session.invoke('scene.create', { operationId: 'hub', sceneId: 'hub', blocks: [{ kind: 'condition', branches: [{ kind: 'if', expr: '!visited', blocks: [{ kind: 'instruction', name: 'jump', args: ['shop'] }] }] }, { kind: 'text', value: '回到据点。' }] })).ok).toBe(true);
      expect((await session.invoke('scene.create', { operationId: 'shop', sceneId: 'shop', blocks: [{ kind: 'text', value: '商店。' }, { kind: 'instruction', name: 'flag', args: ['visited'] }, { kind: 'instruction', name: 'jump', args: ['hub'] }] })).ok).toBe(true);
      expectFailure(await session.invoke('change.commit', {}), 'POLICY_BLOCKED');
      const description = await session.describe();
      expect(description.activeChange).toMatchObject({ compositionMode: 'direct' });
      expect(description.candidateReadiness).toMatchObject({ mode: 'direct', status: 'not-applicable' });
      expect(description.nextActions).toContain('runtime.run-from');
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule).toMatchObject({ compositionMode: 'direct', composition: { eligibility: 'unavailable' } });
      expect(capsule.composition).not.toHaveProperty('manifest');
      const previews = new PreviewContentService(data);
      expect(await previews.list(root)).toEqual(expect.arrayContaining([expect.objectContaining({ target: { kind: 'working-change', changeId } })]));
      expect((await previews.list(root)).some((item) => item.target.kind === 'candidate')).toBe(false);
      const preview = await previews.resolve(root, { kind: 'working-change', changeId });
      expect((await preview.storage.readText('content/scenario/hub.gal')).text).toContain('@jump shop');
      await expect(previews.resolve(root, { kind: 'candidate', changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 })).rejects.toMatchObject({ code: 'CANDIDATE_NOT_COMPOSABLE' });
      const sealed = fs.readFileSync(capsule.artifactIdentity.path);
      await session.close();
      session = await open(root, data, 'stage', changeId);
      expect((await session.describe()).activeChange).toMatchObject({ changeId, compositionMode: 'direct' });
      expect((await session.invoke('scene.create', { operationId: 'after-resume', sceneId: 'ending' })).ok).toBe(true);
      expect(fs.readFileSync(capsule.artifactIdentity.path)).toEqual(sealed);
      expect(projectBytes(root)).toEqual(original);
      await session.close();
      session = await open(root, data, 'apply', changeId);
      expect((await session.describe()).activeChange?.compositionMode).toBe('direct');
      expect((await session.invoke('project.validate', {})).ok).toBe(true);
      expect((await session.invoke('project.simulate', { sceneId: 'hub' })).ok).toBe(true);
      expect((await session.invoke('runtime.run-from', { sceneId: 'hub', choices: [] })).ok).toBe(true);
      expect((await session.invoke('change.diff', {})).ok).toBe(true);
      const committed = await session.invoke('change.commit', {});
      expect(committed, JSON.stringify(committed)).toMatchObject({ ok: true });
      expect(fs.readFileSync(path.join(root, 'content/scenario/hub.gal'), 'utf8')).toContain('@jump shop');
    } finally { await session.close(); }
  });

  it('binds one canonical project and rejects project/change injection in payload', async () => {
    const root = makeProject('binding');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    const absolute = await session.describe();
    const same = await open(path.relative(process.cwd(), root), data, 'stage');
    expect((await same.describe()).projectIdentity).toBe(absolute.projectIdentity);
    expect((await session.invoke('change.begin', {})).ok).toBe(true);

    const result = await session.invoke('scene.create', {
      operationId: 'op-injected-context',
      sceneId: 'blocked',
      projectRoot: root,
      changeId: 'forged',
    });
    expectFailure(result, 'INVALID_REQUEST');
    await session.close();
    await same.close();
  });

  it('exposes stable human-review state without review filesystem paths', async () => {
    const root = makeProject('review-summary');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    const description = await session.describe();
    expect((description as any).review).toEqual({ reviewState: 'unreviewed' });
    expect(JSON.stringify(description)).not.toContain(root);
    await session.close();
  });

  it('observe cannot begin or mutate', async () => {
    const root = makeProject('observe');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const beforeData = dataBytes(data);
    const session = await open(root, data, 'observe');
    expectFailure(await session.invoke('change.begin', {}), 'POLICY_BLOCKED');
    expectFailure(await session.invoke('scene.create', { operationId: 'op-observe', sceneId: 'blocked' }), 'POLICY_BLOCKED');
    expect(projectBytes(root)).toEqual(beforeProject);
    expect(dataBytes(data)).toEqual(beforeData);
    await session.close();
  });

  it('stage cannot commit and keeps the transaction OPEN', async () => {
    const root = makeProject('stage');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    const begun = await session.invoke('change.begin', {});
    expect(begun.ok).toBe(true);
    const changeId = session.activeChangeId;
    expect(changeId).toBeDefined();
    expect((await session.invoke('scene.create', { operationId: 'op-stage', sceneId: 'staged' })).ok).toBe(true);
    expectFailure(await session.invoke('change.commit', {}), 'POLICY_BLOCKED');
    expect(projectBytes(root)).toEqual(beforeProject);
    const reopened = await session.describe();
    expect(reopened.activeChange?.status).toBe('OPEN');
    expect(reopened.activeChange?.changeId).toBe(changeId);
    await session.close();
  });

  it('apply starts without a hidden change', async () => {
    const root = makeProject('apply');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const beforeData = dataBytes(data);
    const session = await open(root, data, 'apply');
    expectFailure(await session.invoke('scene.create', { operationId: 'op-hidden', sceneId: 'blocked' }), 'SESSION_STATE_INVALID');
    expect(projectBytes(root)).toEqual(beforeProject);
    expect(dataBytes(data)).toEqual(beforeData);
    await session.close();
  });

  it.each(['observe', 'stage', 'apply'] as const)('reports config/text mutations consistently before a change exists (%s)', async policy => {
    const root = makeProject(`config-state-${policy}`);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-config-state-'));
    temporaryRoots.push(data);
    const before = projectBytes(root);
    const session = await open(root, data, policy);
    const capabilities = ['project.stage-config.patch', 'project.theme-config.patch', 'project.ui.patch', 'project.texts.patch'] as const;
    try {
      const description = await session.describe();
      for (const capability of capabilities) {
        expect(description.capabilities.find(item => item.id === capability)?.availability)
          .toBe(policy === 'observe' ? 'policy-blocked' : 'state-blocked');
        expectFailure(await session.invoke(capability, getCapabilityDefinition(capability).minimalExample.input),
          policy === 'observe' ? 'POLICY_BLOCKED' : 'SESSION_STATE_INVALID');
      }
      expect(session.activeChangeId).toBeUndefined();
      expect(projectBytes(root)).toEqual(before);
      if (policy !== 'observe') {
        expect((await session.invoke('change.begin', { compositionMode: 'direct' })).ok).toBe(true);
        const active = await session.describe();
        for (const capability of capabilities) {
          expect(active.capabilities.find(item => item.id === capability)?.availability).toBe('available');
        }
        expect((await session.invoke('change.rollback', {})).ok).toBe(true);
        expect(projectBytes(root)).toEqual(before);
      }
    } finally { await session.close(); }
  });

  it('reports the integration commit gate before freshness gates', async () => {
    const root = makeProject('integration-commit-gate');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'apply');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    await NodeChangeStore.withChangeLease(changeId, async (leasedStore) => {
      const record = await leasedStore.read(changeId);
      if (record === null) throw new Error(`missing change ${changeId}`);
      await leasedStore.write({
        ...record,
        recordVersion: record.recordVersion + 1,
        integration: {
          planId: 'pln_commit_gate_probe',
          planFingerprint: 'b'.repeat(64),
          executeOperationId: 'exec-commit-gate-probe',
          sourceCapsules: [],
          includedUnitIds: [],
          deduplicatedUnits: [],
          conflictResolutions: [],
          status: 'REPLAYING',
          nextOperationIndex: 1,
          replayedOperations: [],
        },
      }, {
        expectedRecordVersion: record.recordVersion,
        expectedStatus: record.status,
      });
    });

    expectFailure(await session.invoke('change.commit', {}), 'COMPOSITION_INCOMPLETE');
    await session.close();
  });

  it('rejects a READY integration without approval before creating a commit journal', async () => {
    const root = makeProject('integration-approval-gate');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'apply');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    await NodeChangeStore.withChangeLease(changeId, async (leasedStore) => {
      const record = await leasedStore.read(changeId);
      if (record === null) throw new Error(`missing change ${changeId}`);
      await leasedStore.write({
        ...record,
        recordVersion: record.recordVersion + 1,
        latestValidation: { workingRevision: record.workingRevision, evidenceId: 'validation-gate', errors: 0 },
        latestSimulation: { workingRevision: record.workingRevision, evidenceId: 'simulation-gate', status: 'passed' },
        runtimeTraces: [{ traceId: 'runtime-gate', workingRevision: record.workingRevision, status: 'passed' }],
        integration: {
          planId: 'pln_approval_gate_probe',
          planFingerprint: 'b'.repeat(64),
          executeOperationId: 'exec-approval-gate-probe',
          sourceCapsules: [],
          includedUnitIds: [],
          deduplicatedUnits: [],
          conflictResolutions: [],
          status: 'READY',
          nextOperationIndex: 0,
          replayedOperations: [],
          review: { binding: { reviewState: 'unreviewed' } },
        },
      }, {
        expectedRecordVersion: record.recordVersion,
        expectedStatus: record.status,
      });
    });

    expectFailure(await session.invoke('change.commit', {}), 'REVIEW_APPROVAL_REQUIRED');
    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    expect(await opened!.store.readLatestJournal(changeId)).toBeNull();
    await session.close();
  });

  it('rejects resume from another project identity', async () => {
    const rootA = makeProject('owner-a');
    const rootB = makeProject('owner-b');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const sessionA = await open(rootA, data, 'stage');
    expect((await sessionA.invoke('change.begin', {})).ok).toBe(true);
    const changeId = sessionA.activeChangeId!;
    const beforeA = projectBytes(rootA);
    const beforeB = projectBytes(rootB);
    await expect(open(rootB, data, 'stage', changeId)).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_MISMATCH' });
    expect(projectBytes(rootA)).toEqual(beforeA);
    expect(projectBytes(rootB)).toEqual(beforeB);
    await sessionA.close();
  });

  it('allows one active change only', async () => {
    const root = makeProject('one-change');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const first = session.activeChangeId;
    expectFailure(await session.invoke('change.begin', {}), 'SESSION_STATE_INVALID');
    expect(session.activeChangeId).toBe(first);
    await session.close();
  });

  it('serializes concurrent invocations without losing successful mutations', async () => {
    const root = makeProject('concurrent-invocations');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;

    const results = await Promise.all([
      session.invoke('scene.create', { operationId: 'op-concurrent-a', sceneId: 'concurrent-a' }),
      session.invoke('scene.create', { operationId: 'op-concurrent-b', sceneId: 'concurrent-b' }),
      session.invoke('variable.ensure', {
        operationId: 'op-concurrent-variable',
        name: 'agent.concurrent',
        type: 'number',
        initial: 0,
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);

    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    expect(opened!.record.workingRevision).toBe(3);
    expect(Object.keys(opened!.record.operations)).toEqual([
      'op-concurrent-a',
      'op-concurrent-b',
      'op-concurrent-variable',
    ]);
    expect(opened!.record.workingFiles['content/scenario/concurrent-a.gal']).toContain('@scene concurrent-a');
    expect(opened!.record.workingFiles['content/scenario/concurrent-b.gal']).toContain('@scene concurrent-b');
    expect(JSON.parse(opened!.record.workingFiles['game.config.json']!)).toMatchObject({
      variables: { 'agent.concurrent': { type: 'number', initial: 0 } },
    });

    const invocations = (await opened!.store.readInvocations(changeId))
      .filter((invocation) => invocation.operationId?.startsWith('op-concurrent-'));
    expect(invocations.map((invocation) => [invocation.workingRevisionBefore, invocation.workingRevisionAfter])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(projectBytes(root)).toEqual(beforeProject);
    await session.close();
  });

  it.each(['null', '[]', '42', '"broken"'])('preserves the corrupted-record failure when the invocation ledger cannot read %s', async (malformed) => {
    const root = makeProject('corrupt-record-root');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const changeId = session.activeChangeId!;
      const opened = (await NodeChangeStore.openByChangeId(changeId))!;
      const file = path.join(opened.store.projectDirectory, changeId, 'records', `${String(opened.record.recordVersion).padStart(10, '0')}.json`);
      fs.writeFileSync(file, malformed);
      const beforeData = dataBytes(data);
      const failed = await session.invoke('change.diff', {});
      expectFailure(failed, 'CHANGE_STORE_CORRUPT');
      if (failed.ok) throw new Error('expected corrupt record failure');
      expect(failed.error.retryDisposition).toBe('manual-recovery');
      expect(failed.error.details).toMatchObject({ invocationLedgerFailure: { code: 'INVOCATION_LEDGER_WRITE_FAILED', message: expect.any(String) } });
      expect(dataBytes(data)).toEqual(beforeData);
      expect(projectBytes(root)).toEqual(beforeProject);
      await expect(open(root, data, 'stage', changeId)).rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
    } finally { await session.close(); }
  });

  it.each([null, 42, undefined])('rejects corrupted projectRootIdentity %j before path normalization', async (projectRootIdentity) => {
    const root = makeProject('corrupt-record-identity');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    const beforeProject = projectBytes(root);
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const changeId = session.activeChangeId!;
      const opened = (await NodeChangeStore.openByChangeId(changeId))!;
      const file = path.join(opened.store.projectDirectory, changeId, 'records', `${String(opened.record.recordVersion).padStart(10, '0')}.json`);
      const malformed = JSON.stringify({ ...opened.record, projectRootIdentity });
      fs.writeFileSync(file, malformed);
      const beforeData = dataBytes(data);
      const failed = await session.invoke('change.diff', {});
      expectFailure(failed, 'CHANGE_STORE_CORRUPT');
      if (failed.ok) throw new Error('expected corrupt identity failure');
      expect(failed.error.retryDisposition).toBe('manual-recovery');
      expect(dataBytes(data)).toEqual(beforeData);
      expect(projectBytes(root)).toEqual(beforeProject);
    } finally { await session.close(); }
  });

  it('retains a failed operation and discloses its secondary invocation-ledger failure', async () => {
    const root = makeProject('failed-operation-ledger');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const opened = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!;
    const beforeRecord = opened.record;
    const writeInvocation = vi.spyOn(NodeChangeStore.prototype, 'writeInvocation')
      .mockImplementationOnce(async () => { throw new Error('simulated failed-call ledger failure'); });
    try {
      const failed = await session.invoke('scene.create', { operationId: 'conflicting-scene', sceneId: 'start' });
      expectFailure(failed, 'OBJECT_PRECONDITION_FAILED');
      if (failed.ok) throw new Error('expected existing scene failure');
      expect(failed.error.details).toMatchObject({ invocationLedgerFailure: { code: 'INVOCATION_LEDGER_WRITE_FAILED', message: 'simulated failed-call ledger failure' } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(beforeRecord);
      expect(projectBytes(root)).toEqual(beforeProject);
    } finally { writeInvocation.mockRestore(); await session.close(); }
  });

  it('reports invocation-ledger failure truthfully and retries an idempotent operation without a second mutation', async () => {
    const root = makeProject('invocation-ledger-failure');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const writeInvocation = vi.spyOn(NodeChangeStore.prototype, 'writeInvocation')
      .mockImplementationOnce(async () => { throw new Error('simulated invocation ledger failure'); });
    try {
      const first = await session.invoke('scene.create', { operationId: 'op-ledger-retry', sceneId: 'ledger-retry' });
      expect(first.ok).toBe(false);
      if (first.ok) throw new Error('expected invocation-ledger failure');
      expect(first.error.message).toContain('调用事实记录写入失败');
      expect(first.error.details).toMatchObject({ operationMayHaveSucceeded: true, operationId: 'op-ledger-retry', changeId });
      expect(first.error.details?.invocationResult).toMatchObject({ ok: true, changeId });

      const second = await session.invoke('scene.create', { operationId: 'op-ledger-retry', sceneId: 'ledger-retry' });
      expect(second.ok).toBe(true);
      const opened = await NodeChangeStore.openByChangeId(changeId);
      expect(opened).not.toBeNull();
      expect(opened!.record.workingRevision).toBe(1);
      expect(Object.keys(opened!.record.operations)).toEqual(['op-ledger-retry']);
      const facts = (await opened!.store.readInvocations(changeId))
        .filter((invocation) => invocation.operationId === 'op-ledger-retry');
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ workingRevisionBefore: 1, workingRevisionAfter: 1, ok: true });
    } finally {
      writeInvocation.mockRestore();
      await session.close();
    }
  });

  it('close preserves an OPEN transaction and working files', async () => {
    const root = makeProject('close');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    expect((await session.invoke('scene.create', { operationId: 'op-close', sceneId: 'kept' })).ok).toBe(true);
    await session.close();
    const resumed = await open(root, data, 'stage', changeId);
    const description = await resumed.describe();
    expect(description.activeChange?.status).toBe('OPEN');
    expect(description.activeChange?.workingRevision).toBe(1);
    expect(projectBytes(root)).toEqual(beforeProject);
    await resumed.close();
  });

  it('resumes STALE as recovery-only and exposes apply recovery policy', async () => {
    const root = makeProject('stale-resume');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const stage = await open(root, data, 'stage');
    expect((await stage.invoke('change.begin', {})).ok).toBe(true);
    const changeId = stage.activeChangeId!;
    await stage.close();
    await setTerminalOrStaleStatus(changeId, 'STALE');

    const resumedStage = await open(root, data, 'stage', changeId);
    const stageDescription = await resumedStage.describe();
    expect(stageDescription.activeChange).toMatchObject({ changeId, status: 'STALE', recordVersion: 1 });
    expect(stageDescription.manualRecoveryRequired).toBe(true);
    expect(stageDescription.recoveryDisposition).toBe('MANUAL_RECOVERY_REQUIRED');
    expect(stageDescription.nextActions).toEqual(['change.recovery.inspect']);
    expect(stageDescription.capabilities.find((item) => item.id === 'change.recovery.inspect')).toMatchObject({ availability: 'available' });
    expect(stageDescription.capabilities.find((item) => item.id === 'change.recovery.execute')).toMatchObject({ availability: 'policy-blocked' });
    expect(stageDescription.capabilities.find((item) => item.id === 'scene.create')).toMatchObject({ availability: 'state-blocked' });

    const inspectedStage = await resumedStage.invoke('change.recovery.inspect', {});
    expect(inspectedStage.ok).toBe(true);
    if (inspectedStage.ok) expect(inspectedStage.result).toMatchObject({ changeId, disposition: 'MANUAL_RECOVERY_REQUIRED', manualRecoveryRequired: true });
    expectFailure(await resumedStage.invoke('change.recovery.execute', { operationId: 'op-stage-recovery', recoveryToken: 'unused' }), 'POLICY_BLOCKED');
    await resumedStage.close();

    const resumedApply = await open(root, data, 'apply', changeId);
    const applyDescription = await resumedApply.describe();
    expect(applyDescription.capabilities.find((item) => item.id === 'change.recovery.execute')).toMatchObject({ availability: 'available' });
    const inspectedApply = await resumedApply.invoke('change.recovery.inspect', {});
    expect(inspectedApply.ok).toBe(true);
    if (!inspectedApply.ok) throw new Error('expected recovery inspection');
    const recoveryToken = (inspectedApply.result as { recoveryToken?: unknown }).recoveryToken;
    expect(typeof recoveryToken).toBe('string');
    expectFailure(await resumedApply.invoke('change.recovery.execute', {
      operationId: 'op-apply-recovery',
      recoveryToken,
    }), 'RECOVERY_AMBIGUOUS');
    await resumedApply.close();
  });

  it('resumes terminal changes read-only without reopening mutation capabilities', async () => {
    const root = makeProject('terminal-resume');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    await session.close();
    await setTerminalOrStaleStatus(changeId, 'COMMITTED');

    const resumed = await open(root, data, 'stage', changeId);
    const description = await resumed.describe();
    expect(description.activeChange).toMatchObject({ changeId, status: 'COMMITTED', recordVersion: 1 });
    expect(description.manualRecoveryRequired).toBe(false);
    expect(description.nextActions).toEqual(['change.recovery.inspect']);
    expect(description.capabilities.find((item) => item.id === 'change.recovery.inspect')).toMatchObject({ availability: 'available' });
    expect(description.capabilities.find((item) => item.id === 'scene.create')).toMatchObject({ availability: 'state-blocked' });
    expect(description.capabilities.find((item) => item.id === 'project.inspect')).toMatchObject({ availability: 'state-blocked' });
    expect(await resumed.invoke('project.inspect', {})).toMatchObject({ ok: false, error: { code: 'SESSION_STATE_INVALID' } });
    const inspected = await resumed.invoke('change.recovery.inspect', {});
    expect(inspected.ok).toBe(true);
    if (inspected.ok) expect(inspected.result).toMatchObject({ changeId, disposition: 'NO_ACTION', manualRecoveryRequired: false });
    await resumed.close();
  });
});
