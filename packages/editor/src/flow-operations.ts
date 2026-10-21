import {
  applySceneCreate, applyScenePatch, beginChange, buildObjectIndex, InMemoryChangeRepository, parseSceneStructure, splitInstruction,
  type ChangeSession, type ObjectIndex, type ProjectSnapshot, type SceneBlockInput, type SceneChoiceOptionInput, type ScenePatchOperation,
} from '@surdet/authoring';
import { findChoiceArrow, findChoiceCondition } from '@surdet/core';
import { storySnapshot } from './story-check.js';

/**
 * Flow-map edits run the shared scene.create / scene.patch operations on an
 * in-memory change of the editor's current files. The result is only a
 * proposal: its text goes through the existing undo and save chain once the
 * writer has seen the source diff.
 */
export interface FlowEndpoint { sceneId: string; label?: string }
/** The source line whose instruction or choice option makes a connection. */
export interface FlowEdgeSource { sceneId: string; line: number; kind: 'goto' | 'loop' | 'jump' | 'call' | 'choice' }

export type FlowEdit =
  | { kind: 'connect'; from: FlowEndpoint; to: FlowEndpoint }
  | { kind: 'branch'; from: FlowEndpoint; options: { label: string; to: FlowEndpoint }[] }
  | { kind: 'create'; from: FlowEndpoint; sceneId: string }
  | { kind: 'retarget'; edge: FlowEdgeSource; to: FlowEndpoint }
  | { kind: 'remove'; edge: FlowEdgeSource };

export interface FlowEditFile { path: string; sceneId: string; before: string | null; after: string }
export interface FlowEditPlan { summary: string; note?: string; files: FlowEditFile[] }

const TERMINALS = new Set(['end', 'jump', 'goto', 'loop', 'return']);

export const endpointName = (endpoint: FlowEndpoint): string => endpoint.label === undefined ? `${endpoint.sceneId} 开头` : `${endpoint.sceneId} · ${endpoint.label}`;

/** Same-scene labels use @goto; anything else, including a scene start, uses @jump. */
function jumpTarget(from: string, to: FlowEndpoint): { name: 'goto' | 'jump'; value: string } {
  if (to.sceneId === from && to.label !== undefined) return { name: 'goto', value: to.label };
  return { name: 'jump', value: to.label === undefined ? to.sceneId : `${to.sceneId}.${to.label}` };
}

interface Session { snapshot: ProjectSnapshot; index: ObjectIndex; change: ChangeSession }

async function session(files: Record<string, string>): Promise<Session> {
  const snapshot = await storySnapshot({ files });
  return { snapshot, index: buildObjectIndex(snapshot), change: await beginChange(snapshot, new InMemoryChangeRepository()) };
}

function sceneOf(snapshot: ProjectSnapshot, sceneId: string) {
  const scene = snapshot.scenes.find(item => item.id === sceneId);
  if (!scene) throw new Error(`场景不存在：${sceneId}`);
  return scene;
}

/** The public object facts for one source line: its ref and recorded fingerprint, never computed here. */
function objectAt(index: ObjectIndex, sceneId: string, line: number): { ref: string; fingerprint: string } {
  const object = index.objects.find(item => item.source?.line === line
    && (item.objectRef.startsWith(`scene:${sceneId}/`) || item.objectRef.startsWith(`label:${sceneId}.`)));
  if (!object?.fingerprint) throw new Error(`${sceneId} 第 ${line} 行没有可定位的源对象`);
  return { ref: object.objectRef, fingerprint: object.fingerprint };
}

interface Placement { patch: Extract<ScenePatchOperation, { kind: 'insertAfter' | 'insertBefore' }>['kind']; anchor: string; fingerprint: string; line: number; describe: string; note?: string }

/**
 * Where a connection leaving a scene start or a label segment goes: before a
 * real top-level terminator, before the next label of an empty segment, or
 * after the segment's last top-level object. A branch end nested in @if or a
 * choice is never taken as the segment's end.
 */
export function flowPlacement(snapshot: ProjectSnapshot, index: ObjectIndex, from: FlowEndpoint): Placement {
  const scene = sceneOf(snapshot, from.sceneId);
  const lines = scene.document;
  const headIndex = from.label === undefined
    ? lines.findIndex(line => line.kind === 'instr' && line.name === 'scene')
    : lines.findIndex(line => line.kind === 'label' && line.name === from.label);
  if (from.label !== undefined && headIndex < 0) throw new Error(`段落标记不存在：${endpointName(from)}`);
  const start = headIndex + 2; // first body line, one-based
  let end = lines.length;
  for (let line = start; line <= lines.length; line++) if (lines[line - 1]!.kind === 'label') { end = line - 1; break; }
  let last = 0;
  for (let line = end; line >= start; line--) {
    const kind = lines[line - 1]!.kind;
    if (kind !== 'blank' && kind !== 'comment') { last = line; break; }
  }
  if (last === 0) {
    const next = lines[end];
    if (next?.kind === 'label') {
      const anchor = objectAt(index, scene.id, end + 1);
      return { patch: 'insertBefore', anchor: anchor.ref, fingerprint: anchor.fingerprint, line: end + 1, describe: `插在第 ${end + 1} 行的段落标记 ${next.name} 之前（这一段原本没有内容）` };
    }
    if (headIndex < 0) throw new Error(`${scene.id} 没有场景声明，无法确定插入位置`);
    const anchor = objectAt(index, scene.id, headIndex + 1);
    return { patch: 'insertAfter', anchor: anchor.ref, fingerprint: anchor.fingerprint, line: headIndex + 1, describe: `插在第 ${headIndex + 1} 行之后（这一段原本没有内容）` };
  }
  const structures = parseSceneStructure(scene.file.text, scene.path, scene.id);
  const spans = [...structures.choices.map(item => item.span), ...structures.conditions.map(item => item.span)];
  const enclosing = spans.filter(span => span.startLine <= last && last <= span.endLine)
    .sort((left, right) => (right.endLine - right.startLine) - (left.endLine - left.startLine))[0];
  if (enclosing) last = enclosing.endLine;
  const row = lines[last - 1]!;
  const topTerminal = (line: number): boolean => {
    const item = lines[line - 1]!;
    return item.kind === 'instr' && TERMINALS.has(item.name) && !spans.some(span => span.startLine <= line && line <= span.endLine);
  };
  if (!enclosing && topTerminal(last)) {
    // In a run of exits (`@jump x` then `@end`) the first one is the exit actually taken.
    let exit = last;
    for (let line = last - 1; line >= start; line--) {
      const kind = lines[line - 1]!.kind;
      if (kind === 'blank' || kind === 'comment') continue;
      if (!topTerminal(line)) break;
      exit = line;
    }
    const name = (lines[exit - 1] as { name: string }).name;
    const anchor = objectAt(index, scene.id, exit);
    return { patch: 'insertBefore', anchor: anchor.ref, fingerprint: anchor.fingerprint, line: exit,
      describe: `插在第 ${exit} 行的 @${name} 之前`,
      note: `原来第 ${exit} 行的 @${name} 会移到新连接之后，按顺序走到这里时不再执行它。` };
  }
  const anchor = objectAt(index, scene.id, last);
  return { patch: 'insertAfter', anchor: anchor.ref, fingerprint: anchor.fingerprint, line: last,
    describe: enclosing ? `插在第 ${last} 行（${structures.choices.some(item => item.span === enclosing) ? '选择组' : '条件块'}结束）之后` : `插在第 ${last} 行之后` };
}

/** One instruction line as typed input: name, arguments and `@name=value` modifiers. */
function instructionInput(raw: string): Extract<SceneBlockInput, { kind: 'instruction' }> {
  const { name, args } = splitInstruction(raw);
  const head = raw.trimStart();
  const core = `@${name}${args.length ? ` ${args.join(' ')}` : ''}`;
  const rest = head.startsWith(core) ? head.slice(core.length) : '';
  const modifiers: Record<string, string> = {};
  for (const match of rest.matchAll(/(?:^|\s)@([^\s=]+)(?:=(\S*))?/g)) modifiers[match[1]!] = match[2] ?? '';
  return { kind: 'instruction', name, args, ...(Object.keys(modifiers).length ? { modifiers } : {}) };
}

/** One choice option line as typed input. Effects are the commands before the final @goto/@jump. */
function optionInput(raw: string): SceneChoiceOptionInput {
  const trimmed = raw.trim();
  const arrow = findChoiceArrow(trimmed);
  if (!arrow) throw new Error('这个选项没有 -> 连接');
  let label = trimmed.slice(0, arrow.index).trim();
  let when: string | null = null;
  const condition = findChoiceCondition(label);
  if (condition) { when = condition.value; label = label.slice(0, condition.index).trim(); }
  const commands: { name: string; args: string[] }[] = [];
  for (const token of trimmed.slice(arrow.end).trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('@')) commands.push({ name: token.slice(1), args: [] });
    else if (commands.length) commands.at(-1)!.args.push(token);
    else throw new Error('无法读取这个选项的连接');
  }
  const target = commands.pop();
  if (!target || (target.name !== 'goto' && target.name !== 'jump') || target.args.length !== 1) throw new Error('这个选项不是以 @goto 或 @jump 结束');
  return { label, ...(when === null ? {} : { when }), ...(commands.length ? { effects: commands } : {}), target: { kind: target.name, value: target.args[0]! } };
}

const operationId = (): string => crypto.randomUUID();

/** The shared renderer must reproduce the line unchanged before only its target is changed. */
async function assertRoundTrip(files: Record<string, string>, sceneId: string, line: number, patch: (object: { ref: string; fingerprint: string }) => ScenePatchOperation): Promise<void> {
  const probe = await session(files);
  const scene = sceneOf(probe.snapshot, sceneId);
  const result = await applyScenePatch(probe.change, { operationId: operationId(), sceneId, patch: patch(objectAt(probe.index, sceneId, line)) });
  if (probe.change.record.workingFiles[result.path] !== scene.file.text) throw new Error('这一行的写法无法原样保留条件、效果或修饰，请在剧本里直接修改');
}

function changed(run: Session): FlowEditFile[] {
  const out: FlowEditFile[] = [];
  for (const [path, text] of Object.entries(run.change.record.workingFiles)) {
    const original = run.snapshot.files.find(file => file.path === path)?.text ?? null;
    if (original === text) continue;
    const sceneId = run.snapshot.scenes.find(scene => scene.path === path)?.id ?? path.replace(/^.*\//, '').replace(/\.gal$/, '');
    out.push({ path, sceneId, before: original, after: text });
  }
  return out;
}

/** Plan one flow-map edit on the given files. Nothing is written; the caller shows the diff first. */
export async function planFlowEdit(files: Record<string, string>, edit: FlowEdit): Promise<FlowEditPlan> {
  const run = await session(files);
  const { snapshot, index, change } = run;
  const patch = (sceneId: string, operation: ScenePatchOperation) => applyScenePatch(change, { operationId: operationId(), sceneId, patch: operation });
  if (edit.kind === 'connect' || edit.kind === 'branch' || edit.kind === 'create') {
    const place = flowPlacement(snapshot, index, edit.from);
    let blocks: SceneBlockInput[], summary: string;
    if (edit.kind === 'branch') {
      if (edit.options.length < 1 || edit.options.some(option => option.label.trim() === '')) throw new Error('每个选项都需要文字');
      blocks = [{ kind: 'choice', options: edit.options.map(option => {
        const target = jumpTarget(edit.from.sceneId, option.to);
        return { label: option.label.trim(), target: { kind: target.name, value: target.value } };
      }) }];
      summary = `在 ${endpointName(edit.from)} 添加 ${edit.options.length} 个选项`;
    } else {
      let to: FlowEndpoint = edit.kind === 'create' ? { sceneId: edit.sceneId } : edit.to;
      if (edit.kind === 'create') {
        await applySceneCreate(change, { operationId: operationId(), sceneId: edit.sceneId, blocks: [] });
        to = { sceneId: edit.sceneId };
      }
      const target = jumpTarget(edit.from.sceneId, to);
      blocks = [{ kind: 'instruction', name: target.name, args: [target.value] }];
      summary = edit.kind === 'create' ? `新建场景 ${edit.sceneId}，从 ${endpointName(edit.from)} 连过去` : `从 ${endpointName(edit.from)} 连到 ${endpointName(to)}`;
    }
    await patch(edit.from.sceneId, { kind: place.patch, anchor: place.anchor, expectedFingerprint: place.fingerprint, blocks });
    return { summary: `${summary}：${place.describe}`, ...(place.note ? { note: place.note } : {}), files: changed(run) };
  }
  const { edge } = edit;
  const scene = sceneOf(snapshot, edge.sceneId);
  const row = scene.document[edge.line - 1];
  const object = objectAt(index, edge.sceneId, edge.line);
  if (edit.kind === 'remove') {
    await patch(edge.sceneId, { kind: 'removeObject', target: object.ref, expectedFingerprint: object.fingerprint });
    return { summary: edge.kind === 'choice' ? `删除 ${edge.sceneId} 第 ${edge.line} 行的选项及其连接` : `删除 ${edge.sceneId} 第 ${edge.line} 行的连接`,
      ...(edge.kind === 'choice' ? { note: '选项本身也会删除；只想换去处请用“改目标”。' } : {}), files: changed(run) };
  }
  if (edge.kind === 'choice') {
    if (row?.kind !== 'choice-option') throw new Error(`${edge.sceneId} 第 ${edge.line} 行已不是选项，请刷新流程图`);
    const option = optionInput(row.raw);
    await assertRoundTrip(files, edge.sceneId, edge.line, item => ({ kind: 'replaceChoiceOption', target: item.ref, expectedFingerprint: item.fingerprint, option }));
    const target = jumpTarget(edge.sceneId, edit.to);
    await patch(edge.sceneId, { kind: 'replaceChoiceOption', target: object.ref, expectedFingerprint: object.fingerprint,
      option: { ...option, target: { kind: target.name, value: target.value } } });
    return { summary: `把选项「${option.label}」改为去 ${endpointName(edit.to)}（条件和效果保持不变）`, files: changed(run) };
  }
  if (row?.kind !== 'instr' || !['goto', 'loop', 'jump', 'call'].includes(row.name)) throw new Error(`${edge.sceneId} 第 ${edge.line} 行已不是跳转，请刷新流程图`);
  const original = instructionInput(row.raw);
  const replaceable = original as Extract<ScenePatchOperation, { kind: 'replaceInstruction' }>['instruction'];
  await assertRoundTrip(files, edge.sceneId, edge.line, item => ({ kind: 'replaceInstruction', target: item.ref, expectedFingerprint: item.fingerprint, instruction: replaceable }));
  const target = jumpTarget(edge.sceneId, edit.to);
  const name = original.name === 'call' ? 'call' : target.name;
  const value = original.name === 'call' ? (edit.to.label === undefined ? edit.to.sceneId : `${edit.to.sceneId}.${edit.to.label}`) : target.value;
  await patch(edge.sceneId, { kind: 'replaceInstruction', target: object.ref, expectedFingerprint: object.fingerprint,
    instruction: { ...replaceable, name, args: [value, ...original.args!.slice(1)] } });
  return { summary: `把 ${edge.sceneId} 第 ${edge.line} 行的 @${original.name} 改为去 ${endpointName(edit.to)}`, files: changed(run) };
}
