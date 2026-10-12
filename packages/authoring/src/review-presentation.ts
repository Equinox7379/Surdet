import type {
  CompositionOperation,
  JsonValue,
} from './composition-contracts.js';
import type { ReviewUnitPresentation } from './review-contracts.js';
import { inlinePlainText } from '@surdet/core';

const MAX_HIGHLIGHTS = 8;
const MAX_HIGHLIGHT_CHARS = 160;

type JsonRecord = { [key: string]: JsonValue };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringAt(value: JsonRecord, key: string): string | undefined {
  const item = value[key];
  return typeof item === 'string' && item.trim().length > 0 ? item : undefined;
}

function numberAt(value: JsonRecord, key: string): number | undefined {
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function arrayAt(value: JsonRecord, key: string): JsonValue[] {
  const item = value[key];
  return Array.isArray(item) ? item : [];
}

function objectLabel(objectRef: string): string {
  if (objectRef.startsWith('gallery:cgs:')) return `CG ${objectRef.slice('gallery:cgs:'.length)}`;
  const separator = objectRef.indexOf(':');
  const kind = separator < 0 ? objectRef : objectRef.slice(0, separator);
  const id = separator < 0 ? objectRef : objectRef.slice(separator + 1);
  if (kind === 'scene') {
    const [sceneId, structuralRef] = id.split('/', 2);
    if (structuralRef?.startsWith('choice:')) return `场景 ${sceneId} 的选择组`;
    if (structuralRef?.startsWith('choice-option:')) return `场景 ${sceneId} 的选择项`;
    if (structuralRef?.startsWith('condition:')) return `场景 ${sceneId} 的条件块`;
    if (structuralRef?.startsWith('condition-branch:')) return `场景 ${sceneId} 的条件分支`;
    if (structuralRef?.startsWith('instruction:')) return `场景 ${sceneId} 的演出指令`;
    if (structuralRef?.startsWith('text:')) return `场景 ${sceneId} 的台词`;
  }
  switch (kind) {
    case 'scene': return `场景 ${id}`;
    case 'choice': return `选择组 ${id}`;
    case 'choice-option': return `选择项 ${id}`;
    case 'condition': return `条件块 ${id}`;
    case 'condition-branch': return `条件分支 ${id}`;
    case 'instruction': return `演出指令 ${id}`;
    case 'timeline': return `时间轴 ${id}`;
    case 'variable': return `变量 ${id}`;
    case 'character': return `角色 ${id}`;
    case 'config': return id === 'entryScene' ? '项目入口场景' : `项目配置 ${id}`;
    default: return `对象 ${objectRef}`;
  }
}

function boundedHighlights(values: readonly string[], full = false): { highlights: string[]; omittedFactCount: number } {
  const meaningful = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (full) return { highlights: meaningful, omittedFactCount: 0 };
  let omittedFactCount = Math.max(0, meaningful.length - MAX_HIGHLIGHTS);
  const highlights = meaningful.slice(0, MAX_HIGHLIGHTS).map((value) => {
    if (value.length <= MAX_HIGHLIGHT_CHARS) return value;
    omittedFactCount += 1;
    return `${value.slice(0, MAX_HIGHLIGHT_CHARS - 1)}…`;
  });
  return { highlights, omittedFactCount };
}

function scalarLabel(value: JsonValue | undefined): string | undefined {
  if (value === null) return '空值';
  if (typeof value === 'string') return `“${value}”`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return undefined;
}

function variableTypeLabel(value: string): string {
  return ({ string: '文本', number: '数值', boolean: '是/否' } as Record<string, string>)[value] ?? value;
}

function trackKindLabel(value: string): string {
  return ({ background: '背景', portrait: '立绘', screen: '屏幕' } as Record<string, string>)[value] ?? value;
}

function choiceOptionFacts(value: JsonValue | undefined): string[] {
  if (!isRecord(value)) return [];
  const sourceLabel = stringAt(value, 'label');
  if (sourceLabel === undefined) return [];
  const label = inlinePlainText(sourceLabel, 'choice');
  const target = value['target'];
  const details: string[] = [];
  const when = stringAt(value, 'when');
  if (when !== undefined) details.push(`显示条件：${when}`);
  const effects = arrayAt(value, 'effects')
    .map((effect) => {
      if (!isRecord(effect)) return undefined;
      const name = stringAt(effect, 'name');
      if (name === undefined) return undefined;
      const args = arrayAt(effect, 'args').filter((item): item is string => typeof item === 'string');
      return `${name}${args.length === 0 ? '' : `（${args.join('、')}）`}`;
    })
    .filter((effect): effect is string => effect !== undefined);
  if (effects.length > 0) details.push(`效果：${effects.join('、')}`);
  const suffix = details.length === 0 ? '' : `（${details.join('；')}）`;
  if (!isRecord(target)) return [`选项：${label}${suffix}`];
  const targetValue = stringAt(target, 'value');
  return [targetValue === undefined ? `选项：${label}${suffix}` : `选项：${label}${suffix} → ${targetValue}`];
}

function sceneBlockFacts(blocks: readonly JsonValue[]): string[] {
  const facts: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    switch (stringAt(block, 'kind')) {
      case 'text': {
        const value = stringAt(block, 'value');
        if (value === undefined) break;
        const speaker = stringAt(block, 'speaker');
        const visible = inlinePlainText(value);
        facts.push(speaker === undefined ? `台词：${visible}` : `${speaker}：${visible}`);
        break;
      }
      case 'choice': {
        for (const option of arrayAt(block, 'options')) facts.push(...choiceOptionFacts(option));
        break;
      }
      case 'condition': {
        for (const branch of arrayAt(block, 'branches')) {
          if (!isRecord(branch)) continue;
          const kind = stringAt(branch, 'kind');
          const expr = stringAt(branch, 'expr');
          const header = kind === 'else' ? '否则' : `${kind === 'elif' ? '否则如果' : '如果'}${expr === undefined ? '' : `：${expr}`}`;
          const body = sceneBlockFacts(arrayAt(branch, 'blocks'));
          facts.push(body.length === 0 ? `${header}（正文为空）` : `${header}：${body.join('；')}`);
        }
        break;
      }
      case 'instruction': {
        const name = stringAt(block, 'name');
        if (name === undefined) break;
        const args = arrayAt(block, 'args').filter((item): item is string => typeof item === 'string');
        if (name === 'timeline' && args[0] !== undefined) facts.push(`播放时间轴：${args[0]}`);
        else if ((name === 'jump' || name === 'goto') && args[0] !== undefined) facts.push(`跳转到：${args[0]}`);
        else if (name === 'set' && args.length > 0) facts.push(`设置：${args.join('、')}`);
        else facts.push(`演出指令：${name}${args.length > 0 ? `（${args.join('、')}）` : ''}`);
        break;
      }
      case 'label': {
        const name = stringAt(block, 'name');
        if (name !== undefined) facts.push(`段落标记：${name}`);
        break;
      }
    }
  }
  return facts;
}

interface OperationPresentation {
  actionLabel: string;
  highlights: string[];
  completeness: ReviewUnitPresentation['completeness'];
  omittedFactCount: number;
}

function presentationForOperation(operation: CompositionOperation, full = false): OperationPresentation {
  const result = (actionLabel: string, facts: readonly string[], completeness: ReviewUnitPresentation['completeness'] = 'content'): OperationPresentation => ({
    actionLabel, completeness, ...boundedHighlights(facts, full),
  });
  if (!isRecord(operation.normalizedInput)) return result('审阅对象变更', [], 'metadata-only');
  const input = operation.normalizedInput;
  switch (operation.capabilityId) {
    case 'gallery.cg.create':
    case 'gallery.cg.patch': {
      const fields = operation.capabilityId === 'gallery.cg.patch' ? input['patch'] : input;
      if (!isRecord(fields)) return result('修改 CG', [], 'metadata-only');
      const facts = [
        ...(typeof fields['name'] === 'string' ? [`名称：${fields['name']}`] : []),
        ...(typeof fields['src'] === 'string' ? [`图片：${fields['src']}`] : fields['src'] === null ? ['图片：使用 CG ID 对应素材'] : []),
      ];
      return result(operation.capabilityId === 'gallery.cg.create' ? '新增 CG' : '修改 CG', facts);
    }
    case 'scene.create': {
      const facts = sceneBlockFacts(arrayAt(input, 'blocks'));
      return result('新建场景', facts.length === 0 ? ['场景内容为空'] : facts);
    }
    case 'scene.patch': {
      const patch = input['patch'];
      if (!isRecord(patch)) return result('修改场景', [], 'metadata-only');
      switch (stringAt(patch, 'kind')) {
        case 'replaceText': {
          const value = stringAt(patch, 'value');
          if (value === undefined) return result('修改场景', [], 'metadata-only');
          const speaker = stringAt(patch, 'speaker');
          const visible = inlinePlainText(value);
          return result('修改场景', [speaker === undefined ? `替换台词：${visible}` : `${speaker}：${visible}`]);
        }
        case 'insertBefore':
        case 'insertAfter': {
          const facts = sceneBlockFacts(arrayAt(patch, 'blocks'));
          return result('修改场景', facts.length === 0 ? [] : facts, facts.length === 0 ? 'metadata-only' : 'content');
        }
        case 'replaceInstruction': {
          const facts = sceneBlockFacts(patch['instruction'] === undefined ? [] : [patch['instruction']]);
          const instruction = patch['instruction'];
          const modifiers = isRecord(instruction) ? instruction['modifiers'] : undefined;
          if (isRecord(modifiers) && Object.keys(modifiers).length > 0) {
            facts.push(`修饰符：${Object.entries(modifiers).map(([key, value]) => `${key}=${value}`).join('、')}`);
          }
          return result('替换演出指令', facts, facts.length === 0 ? 'metadata-only' : 'content');
        }
        case 'replaceChoiceOption': {
          const facts = choiceOptionFacts(patch['option']);
          return result('修改场景', facts, facts.length === 0 ? 'metadata-only' : 'content');
        }
        case 'replaceChoiceGroup': {
          const facts = patch['choice'] === undefined ? [] : sceneBlockFacts([patch['choice']]);
          return result('替换选择组', facts, facts.length === 0 ? 'metadata-only' : 'content');
        }
        case 'replaceConditionBlock': {
          const condition = patch['condition'];
          const facts: string[] = [];
          if (isRecord(condition)) {
            for (const branch of arrayAt(condition, 'branches')) {
              if (!isRecord(branch)) continue;
              const kind = stringAt(branch, 'kind');
              const expr = stringAt(branch, 'expr');
              const header = kind === 'else' ? '否则' : `${kind === 'elif' ? '否则如果' : '如果'}${expr === undefined ? '' : `：${expr}`}`;
              const body = sceneBlockFacts(arrayAt(branch, 'blocks'));
              const retained = stringAt(branch, 'sourceBranch') !== undefined && branch['blocks'] === undefined;
              facts.push(body.length > 0 ? `${header}：${body.join('；')}` : retained ? `${header}（保留原分支正文）` : `${header}（正文为空）`);
            }
          }
          return result('替换条件块', facts, facts.length === 0 ? 'metadata-only' : 'content');
        }
        case 'removeObject': return result('修改场景', ['移除一项场景内容']);
        default: return result('修改场景', [], 'metadata-only');
      }
    }
    case 'variable.ensure':
    case 'variable.patch-initial': {
      const name = stringAt(input, 'name');
      const initial = scalarLabel(input['initial']);
      const type = operation.capabilityId === 'variable.ensure' ? stringAt(input, 'type') : undefined;
      const facts = operation.capabilityId === 'variable.ensure'
        ? [
          ...(type === undefined ? [] : [`类型：${variableTypeLabel(type)}`]),
          ...(initial === undefined ? ['初始值：结构化数据（未展开）'] : [`初始值：${initial}`]),
        ]
        : [initial === undefined ? '初始值：结构化数据（未展开）' : `初始值：${initial}`];
      return result(operation.capabilityId === 'variable.ensure' ? '设置变量' : '修改变量初始值', facts, name === undefined || initial === undefined ? 'metadata-only' : 'content');
    }
    case 'character.ensure': {
      const name = stringAt(input, 'name');
      const avatar = input['avatar'];
      const facts = [
        ...(name === undefined ? [] : [`显示名：${name}`]),
        ...(avatar === null ? ['头像：无'] : typeof avatar === 'string' ? [`头像：${avatar}`] : []),
      ];
      return result('新建或更新角色', facts, name === undefined ? 'metadata-only' : 'content');
    }
    case 'character.remove': return result('移除角色', ['从项目角色表中移除']);
    case 'timeline.create': {
      const definition = input['definition'];
      if (!isRecord(definition)) return result('新建时间轴', [], 'metadata-only');
      const durationMs = numberAt(definition, 'durationMs');
      const tracks = arrayAt(definition, 'tracks');
      const facts = [
        ...(durationMs === undefined ? [] : [`时长：${durationMs} 毫秒`]),
        `轨道：${tracks.length} 条`,
      ];
      for (const track of tracks) {
        if (!isRecord(track)) continue;
        const kind = trackKindLabel(stringAt(track, 'kind') ?? '未知');
        const target = stringAt(track, 'target');
        facts.push(`${kind} 轨道${target === undefined ? '' : `：${target}`}，${arrayAt(track, 'cues').length} 个演出点`);
      }
      return result('新建时间轴', facts, durationMs === undefined ? 'metadata-only' : 'content');
    }
    case 'timeline.patch': {
      const patch = input['patch'];
      if (!isRecord(patch)) return result('修改时间轴', [], 'metadata-only');
      switch (stringAt(patch, 'kind')) {
        case 'addTrack': {
          const kind = trackKindLabel(stringAt(patch, 'trackKind') ?? '未知');
          const target = stringAt(patch, 'target');
          return result('修改时间轴', [`新增 ${kind} 轨道${target === undefined ? '' : `：${target}`}`]);
        }
        case 'removeTrack': return result('修改时间轴', ['移除一条轨道']);
        case 'insertCue':
        case 'replaceCue': {
          const cue = patch['cue'];
          if (!isRecord(cue)) return result('修改时间轴', [], 'metadata-only');
          const action = stringAt(cue, 'action');
          const atMs = numberAt(cue, 'atMs');
          return result('修改时间轴', [
            `${stringAt(patch, 'kind') === 'insertCue' ? '新增' : '替换'}演出点${action === undefined ? '' : `：${action}`}${atMs === undefined ? '' : `（${atMs} 毫秒）`}`,
          ], action === undefined ? 'metadata-only' : 'content');
        }
        case 'removeCue': return result('修改时间轴', ['移除一个演出点']);
        default: return result('修改时间轴', [], 'metadata-only');
      }
    }
    case 'project.entry-scene.set': {
      const sceneId = stringAt(input, 'sceneId');
      return result('设置入口场景', sceneId === undefined ? [] : [`入口场景：${sceneId}`], sceneId === undefined ? 'metadata-only' : 'content');
    }
  }
  return result('审阅对象变更', [], 'metadata-only');
}

export function metadataOnlyReviewUnitPresentation(primaryObject: string): ReviewUnitPresentation {
  return {
    actionLabel: '内容摘要不足',
    objectLabel: objectLabel(primaryObject),
    highlights: [],
    completeness: 'metadata-only',
    omittedFactCount: 0,
  };
}

/**
 * 从已验证 manifest operation 机械生成 Owner 摘要。这里不读磁盘、不解析输出文件，
 * 也不暴露 operationId、expectedFingerprint 或 normalizedInput 原文。
 */
export function buildReviewUnitPresentation(
  primaryObject: string,
  operations: readonly CompositionOperation[],
  detail: 'summary' | 'full' = 'summary',
): ReviewUnitPresentation {
  if (operations.length === 0) return metadataOnlyReviewUnitPresentation(primaryObject);
  const projected = [...operations]
    .sort((left, right) => left.sequence - right.sequence)
    .map((operation) => presentationForOperation(operation, detail === 'full'));
  const bounded = boundedHighlights(projected.flatMap((item) => item.highlights), detail === 'full');
  const actionLabels = [...new Set(projected.map((item) => item.actionLabel))];
  return {
    actionLabel: actionLabels.length === 1 ? actionLabels[0]! : '组合修改',
    objectLabel: objectLabel(primaryObject),
    highlights: bounded.highlights,
    completeness: projected.every((item) => item.completeness === 'content') ? 'content' : 'metadata-only',
    omittedFactCount: bounded.omittedFactCount + projected.reduce((total, item) => total + item.omittedFactCount, 0),
  };
}
