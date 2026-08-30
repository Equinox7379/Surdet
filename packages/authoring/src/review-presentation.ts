import type {
  CompositionOperation,
  JsonValue,
} from './composition-contracts.js';
import type { ReviewUnitPresentation } from './review-contracts.js';

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
  const separator = objectRef.indexOf(':');
  const kind = separator < 0 ? objectRef : objectRef.slice(0, separator);
  const id = separator < 0 ? objectRef : objectRef.slice(separator + 1);
  switch (kind) {
    case 'scene': return `场景 ${id}`;
    case 'timeline': return `时间轴 ${id}`;
    case 'variable': return `变量 ${id}`;
    case 'character': return `角色 ${id}`;
    case 'config': return id === 'entryScene' ? '项目入口场景' : `项目配置 ${id}`;
    default: return `对象 ${objectRef}`;
  }
}

function boundedHighlights(values: readonly string[]): { highlights: string[]; omittedFactCount: number } {
  const meaningful = values.map((value) => value.trim()).filter((value) => value.length > 0);
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
  const label = stringAt(value, 'label');
  if (label === undefined) return [];
  const target = value['target'];
  if (!isRecord(target)) return [`选项：${label}`];
  const targetValue = stringAt(target, 'value');
  return [targetValue === undefined ? `选项：${label}` : `选项：${label} → ${targetValue}`];
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
        facts.push(speaker === undefined ? `台词：${value}` : `${speaker}：${value}`);
        break;
      }
      case 'choice': {
        for (const option of arrayAt(block, 'options')) facts.push(...choiceOptionFacts(option));
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

function result(
  actionLabel: string,
  facts: readonly string[],
  completeness: ReviewUnitPresentation['completeness'] = 'content',
): OperationPresentation {
  const bounded = boundedHighlights(facts);
  return { actionLabel, completeness, ...bounded };
}

function presentationForOperation(operation: CompositionOperation): OperationPresentation {
  if (!isRecord(operation.normalizedInput)) return result('审阅对象变更', [], 'metadata-only');
  const input = operation.normalizedInput;
  switch (operation.capabilityId) {
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
          return result('修改场景', [speaker === undefined ? `替换台词：${value}` : `${speaker}：${value}`]);
        }
        case 'insertAfter': {
          const facts = sceneBlockFacts(arrayAt(patch, 'blocks'));
          return result('修改场景', facts.length === 0 ? [] : facts, facts.length === 0 ? 'metadata-only' : 'content');
        }
        case 'replaceChoiceOption': {
          const facts = choiceOptionFacts(patch['option']);
          return result('修改场景', facts, facts.length === 0 ? 'metadata-only' : 'content');
        }
        case 'removeObject': return result('修改场景', ['移除一项场景内容']);
        default: return result('修改场景', [], 'metadata-only');
      }
    }
    case 'variable.ensure': {
      const name = stringAt(input, 'name');
      const type = stringAt(input, 'type');
      const initial = scalarLabel(input['initial']);
      const facts = [
        ...(type === undefined ? [] : [`类型：${variableTypeLabel(type)}`]),
        ...(initial === undefined ? ['初始值：结构化数据（未展开）'] : [`初始值：${initial}`]),
      ];
      return result('设置变量', facts, name === undefined || initial === undefined ? 'metadata-only' : 'content');
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
): ReviewUnitPresentation {
  if (operations.length === 0) return metadataOnlyReviewUnitPresentation(primaryObject);
  const projected = [...operations]
    .sort((left, right) => left.sequence - right.sequence)
    .map(presentationForOperation);
  const bounded = boundedHighlights(projected.flatMap((item) => item.highlights));
  const actionLabels = [...new Set(projected.map((item) => item.actionLabel))];
  return {
    actionLabel: actionLabels.length === 1 ? actionLabels[0]! : '组合修改',
    objectLabel: objectLabel(primaryObject),
    highlights: bounded.highlights,
    completeness: projected.every((item) => item.completeness === 'content') ? 'content' : 'metadata-only',
    omittedFactCount: bounded.omittedFactCount + projected.reduce((total, item) => total + item.omittedFactCount, 0),
  };
}
