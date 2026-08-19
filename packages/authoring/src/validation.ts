import {
  attachHints,
  checkChoiceSuspects,
  checkConsumedModifiers,
  collectSceneSpeakers,
  parseVariableConfig,
  validateJumpTarget,
  validateSceneVariables,
  validateSwitchTargets,
  validateTransitionInstructions,
  type CallInstr,
  type CompiledScene,
  type JumpInstr,
  type LintIssue,
} from '@surdet/core';
import type { ObjectIndex } from './object-index.js';
import { buildObjectIndex, buildSpeakerCharacterRefs } from './object-index.js';
import type { ProjectSnapshot } from './project-snapshot.js';
import { validateTimeline, type TimelineDefinition } from '@surdet/core';
import type { ProjectAssetCatalog } from './contracts.js';

export type AuthoringValidationIssue = LintIssue & {
  objectRef?: string;
  action: string;
};

export interface ValidationResult {
  issues: AuthoringValidationIssue[];
  scenes: Map<string, CompiledScene>;
  ok: boolean;
}

export interface ValidationOptions {
  failedScenes?: ReadonlySet<string>;
  /** 只读资源目录（project.inspect/assets 同源）；缺省时不执行资源引用检查。 */
  assetCatalog?: ProjectAssetCatalog;
}

function isRecordLike(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function actionFor(code: string): string {
  switch (code) {
    case 'J002': return '创建或修正标签，再重新校验该跳转';
    case 'J001': return '创建目标场景或修正跳转目标';
    case 'J003': return '先修复目标场景的语法或结构错误';
    case 'CHARACTER_INVALID': return '修正 game.config.json 的角色表结构（name 必须非空）';
    case 'ENTRY_SCENE_MISSING': return '创建该入口场景或把 entryScene 改为存在的场景';
    case 'SPEAKER_UNRESOLVED': return '创建对应角色（character.ensure）或修正台词 speaker';
    default: return `修正 ${code} 对应的源码问题`;
  }
}

function objectRefFor(index: ObjectIndex, issue: LintIssue): string | undefined {
  const candidates = index.objects.filter((object) => (
    object.source?.path === issue.file && object.source.line === issue.line
  ));
  return candidates.find((object) => object.kind === 'choice-option')?.objectRef
    ?? candidates[0]?.objectRef;
}

function enrich(index: ObjectIndex, issue: LintIssue): AuthoringValidationIssue {
  const objectRef = objectRefFor(index, issue);
  return {
    ...issue,
    ...(objectRef === undefined ? {} : { objectRef }),
    action: actionFor(issue.code),
  };
}

/**
 * 以 ProjectSnapshot 为唯一输入的共享项目校验门面。
 * Core 负责 DSL 与变量语义；authoring 只补充稳定对象定位和可执行修复动作。
 */
export function validateSnapshot(
  snapshot: ProjectSnapshot,
  index: ObjectIndex = buildObjectIndex(snapshot),
  options: ValidationOptions = {},
): ValidationResult {
  const rawIssues: LintIssue[] = [];
  const scenes = new Map(snapshot.scenes.map((scene) => [scene.id, scene.compiled]));
  const labels = new Map([...scenes.entries()].map(([id, scene]) => [id, new Set(scene.labels.keys())]));
  const failedScenes = new Set(options.failedScenes ?? []);
  const configPath = snapshot.configFile?.path ?? 'game.config.json';
  const parsed = parseVariableConfig(snapshot.config, configPath, rawIssues);

  for (const scene of scenes.values()) {
    for (const diagnostic of scene.diagnostics) {
      rawIssues.push({
        severity: 'warning',
        code: diagnostic.code,
        text: `${diagnostic.file}:${diagnostic.line}:${diagnostic.col}: ${diagnostic.message}${diagnostic.hint ? `（${diagnostic.hint}）` : ''} [${diagnostic.code}]`,
        file: diagnostic.file,
        line: diagnostic.line,
        col: diagnostic.col,
        ...(diagnostic.hint === undefined ? {} : { hint: diagnostic.hint }),
      });
    }
    validateSwitchTargets(scene, rawIssues);
    validateTransitionInstructions(scene, rawIssues);
    validateSceneVariables(
      scene,
      parsed.variables,
      parsed.types,
      parsed.readonlyVars,
      rawIssues,
      snapshot.configFile !== null,
    );
    checkChoiceSuspects(scene, collectSceneSpeakers(scene), rawIssues);
    for (const instr of scene.instructions) {
      if (instr.op === 'instr') checkConsumedModifiers(instr, rawIssues);
      if (instr.op === 'instr' && instr.name === 'scene') {
        const declared = instr.args[0];
        if (declared !== undefined && declared !== scene.sceneId) {
          rawIssues.push({
            severity: 'error',
            code: 'SCENE_ID',
            text: `${instr.file}:${instr.line}:${instr.col}: @scene 声明 '${declared}' 与文件名推导的场景 ID '${scene.sceneId}' 不一致`,
            file: instr.file,
            line: instr.line,
            col: instr.col,
          });
        }
      }
    }
  }

  for (const [sceneId, scene] of scenes) {
    for (const instr of scene.instructions) {
      if (instr.op === 'jump' && instr.kind === 'jump') {
        validateJumpTarget(sceneId, instr as JumpInstr, labels, failedScenes, rawIssues);
      }
      if (instr.op === 'call') {
        validateJumpTarget(sceneId, instr as CallInstr, labels, failedScenes, rawIssues, '@call');
      }
    }
  }

  // Stage 6 Wave 3：项目级创作配置——characters 结构、entryScene 存在性、speaker/avatar 引用。
  const charactersValue = snapshot.config['characters'];
  const characters: Record<string, unknown> = {};
  if (charactersValue !== undefined) {
    if (typeof charactersValue !== 'object' || charactersValue === null || Array.isArray(charactersValue)) {
      rawIssues.push({
        severity: 'error',
        code: 'CHARACTER_INVALID',
        text: `${configPath}: characters 必须是对象`,
        file: configPath,
        line: 1,
        col: 1,
      });
    } else {
      Object.assign(characters, charactersValue as Record<string, unknown>);
    }
  }
  for (const [id, rawDeclaration] of Object.entries(characters)) {
    const record = isRecordLike(rawDeclaration);
    if (record === null || typeof record['name'] !== 'string' || record['name'].trim().length === 0) {
      rawIssues.push({
        severity: 'error',
        code: 'CHARACTER_INVALID',
        text: `${configPath}: 角色 '${id}' 必须包含非空 name`,
        file: configPath,
        line: 1,
        col: 1,
      });
    }
  }

  const resolvedAvatars = new Map(
    (options.assetCatalog?.avatars ?? []).filter((entry) => entry.resolved).map((entry) => [entry.key, entry]),
  );
  for (const [id, rawDeclaration] of Object.entries(characters)) {
    const record = isRecordLike(rawDeclaration);
    const avatar = record === null ? undefined : record['avatar'];
    if (typeof avatar === 'string' && avatar.trim().length > 0 && !resolvedAvatars.has(avatar.trim())) {
      rawIssues.push({
        severity: 'warning',
        code: 'ASSET_UNRESOLVED',
        text: `${configPath}: 角色 '${id}' 的头像资源 '${avatar}' 未解析（catalog 中不存在或格式不受支持）`,
        file: configPath,
        line: 1,
        col: 1,
      });
    }
  }

  const entryScene = snapshot.config['entryScene'];
  if (typeof entryScene === 'string' && entryScene.trim().length > 0 && !scenes.has(entryScene.trim())) {
    rawIssues.push({
      severity: 'error',
      code: 'ENTRY_SCENE_MISSING',
      text: `${configPath}: 入口场景 '${entryScene}' 不存在`,
      file: configPath,
      line: 1,
      col: 1,
    });
  }

  // 台词 speaker → 角色（placeholder 哲学：缺失只 warning，不阻止 commit；speaker 可为 ID 或显示名）。
  const speakerRefMap = buildSpeakerCharacterRefs(characters);
  for (const scene of snapshot.scenes) {
    scene.document.forEach((line, lineIndex) => {
      if (line.kind !== 'text') return;
      const speaker = line.speaker.trim();
      if (speaker.length === 0 || speakerRefMap.has(speaker)) return;
      rawIssues.push({
        severity: 'warning',
        code: 'SPEAKER_UNRESOLVED',
        text: `${scene.path}:${lineIndex + 1}: 台词 speaker '${speaker}' 不在 characters 中`,
        file: scene.path,
        line: lineIndex + 1,
        col: 1,
      });
    });
  }

  // Stage 6 Wave 2：时间轴结构校验与资源引用检查（结构错误进 error 信封，资源 unresolved 只 warning）。
  // Phase 2A（A1）：区分两个概念——「引用存在性」（JSON parse 成功即算，保持既有 filename 语义，
  // parse 失败的文件名不进存在集合，与修复前 map 行为一致）与「结构可用 definition」（validateTimeline
  // 无 diagnostic 才可进入 semantic/asset traversal）。invalid definition 绝不进入 asset traversal。
  const parsedTimelineNames = new Set<string>();
  const usableTimelineDefinitions = new Map<string, TimelineDefinition>();
  for (const timeline of snapshot.timelines) {
    const name = timeline.path.slice(timeline.path.lastIndexOf('/') + 1, -'.json'.length);
    let definition: TimelineDefinition;
    try {
      const parsed: unknown = JSON.parse(timeline.text.replace(/^\uFEFF/, ''));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('时间轴文件不是 JSON 对象');
      }
      definition = parsed as TimelineDefinition;
    } catch (error) {
      rawIssues.push({
        severity: 'error',
        code: 'TIMELINE_JSON',
        text: `${timeline.path}: 时间轴 JSON 解析失败（${error instanceof Error ? error.message : String(error)}）`,
        file: timeline.path,
        line: 1,
        col: 1,
      });
      continue;
    }
    parsedTimelineNames.add(name);
    const diagnostics = validateTimeline(definition);
    for (const diagnostic of diagnostics) {
      rawIssues.push({
        severity: 'error',
        code: diagnostic.code,
        text: `${timeline.path}:${diagnostic.path ?? '$'}: ${diagnostic.message} [${diagnostic.code}]`,
        file: timeline.path,
        line: 1,
        col: 1,
      });
    }
    if (diagnostics.length === 0) usableTimelineDefinitions.set(name, definition);
  }

  // @timeline 指令的目标存在性（只有快照确实包含时间轴集合时才检查，避免 editor 内联校验误报）。
  // 依据 parsedTimelineNames：结构非法但 parse 成功的文件仍视为存在（与 A1 修复前语义一致，
  // 其结构问题已由 T0xx error 单独报告）；parse 失败的文件名不在集合中（同样与修复前一致）。
  if (snapshot.timelines.length > 0) {
    for (const scene of scenes.values()) {
      for (const instr of scene.instructions) {
        if (instr.op !== 'timeline') continue;
        const id = (instr as { id: string }).id;
        if (parsedTimelineNames.has(id)) continue;
        rawIssues.push({
          severity: 'error',
          code: 'TIMELINE_MISSING',
          text: `${instr.file}:${instr.line}:${instr.col}: 场景引用的时间轴 '${id}' 不在项目内容中`,
          file: instr.file,
          line: instr.line,
          col: instr.col,
        });
      }
    }
  }

  const assetCatalog = options.assetCatalog;
  if (assetCatalog !== undefined) {
    const resolvedBackgrounds = new Map(
      assetCatalog.backgrounds.filter((entry) => entry.resolved).map((entry) => [entry.key, entry]),
    );
    const resolvedPortraits = new Map(
      assetCatalog.portraits
        .filter((entry) => entry.resolved)
        .map((entry) => [`${entry.role ?? ''}:${entry.outfit ?? ''}:${entry.expression ?? ''}`, entry]),
    );
    for (const timeline of snapshot.timelines) {
      const name = timeline.path.slice(timeline.path.lastIndexOf('/') + 1, -'.json'.length);
      // 仅结构可用的 definition 参与 asset traversal：结构非法的（已报 T0xx error）不进入。
      const definition = usableTimelineDefinitions.get(name);
      if (definition === undefined) continue;
      definition.tracks.forEach((track) => {
        track.cues.forEach((cue) => {
          if (track.kind === 'background' && cue.action === 'set' && typeof cue.key === 'string') {
            if (!resolvedBackgrounds.has(cue.key)) {
              rawIssues.push({
                severity: 'warning',
                code: 'ASSET_UNRESOLVED',
                text: `${timeline.path}: 背景资源 '${cue.key}' 未解析（catalog 中不存在或格式不受支持）`,
                file: timeline.path,
                line: 1,
                col: 1,
              });
            }
          } else if (track.kind === 'portrait' && (cue.action === 'show' || cue.action === 'expression')) {
            const target = track.target ?? '';
            const expression = String(cue.expression ?? '');
            if (!resolvedPortraits.has(`${target}:${expression}`)) {
              rawIssues.push({
                severity: 'warning',
                code: 'ASSET_UNRESOLVED',
                text: `${timeline.path}: 立绘资源 '${target}' + 表情 '${expression}' 未解析`,
                file: timeline.path,
                line: 1,
                col: 1,
              });
            }
          }
        });
      });
    }
  }

  attachHints(rawIssues);
  const issues = rawIssues.map((issue) => enrich(index, issue));
  return {
    issues,
    scenes,
    ok: issues.every((issue) => issue.severity !== 'error'),
  };
}
