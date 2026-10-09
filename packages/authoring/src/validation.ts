import { staleTextCatalogKeys } from './text-catalog.js';
import { validateProjectStageContent } from './stage-validation.js';
import { resolveProjectTheme, resolveProjectTitleLogo, readProjectUi, readTextCatalog, textCatalogEntryText } from '@surdet/core';
import { validateThemeAssetBindings } from './theme-operations.js';
import { validateUiAssets } from './ui-operations.js';
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
  isValidSceneId,
  type CallInstr,
  type CompiledScene,
  type JumpInstr,
  type LintIssue,
} from '@surdet/core';
import type { ObjectIndex } from './object-index.js';
import { buildObjectIndex, buildSpeakerCharacterRefs } from './object-index.js';
import { timelineIdFromPath, timelineIdentityConflict, timelineIdentityMismatchMessage } from './timeline-identity.js';
import type { ProjectSnapshot } from './project-snapshot.js';
import { validateTimeline, type TimelineDefinition } from '@surdet/core';
import type { ProjectAssetCatalog } from './contracts.js';
import { validateGalleryConfig } from './gallery-validation.js';
import { GALLERY_PATH } from './gallery-operations.js';
import { parseProjectConfigDocument } from './config-document.js';

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
  /**
   * Phase 2C（A3）：@timeline 引用完整性检查的显式 scope。
   * - complete（默认）：snapshot 即完整项目，无论 timeline 文件数量都检查引用完整性。
   * - partial：调用方明确声明 timeline catalog 不完整（如内联/局部校验），只跳过
   *   “根据 absent 文件推断 TIMELINE_MISSING”；已提供文件的 JSON/结构/identity/asset
   *   校验照常执行。不得用 timeline 数量隐式推断 scope。
   */
  timelineReferenceScope?: 'complete' | 'partial';
}

function isRecordLike(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function actionFor(code: string): string {
  switch (code) {
    case 'LINT_DUP': return '为冲突场景文件分配唯一的 scene ID，再重新校验项目';
    case 'J002': return '创建或修正标签，再重新校验该跳转';
    case 'J001': return '创建目标场景或修正跳转目标';
    case 'J003': return '先修复目标场景的语法或结构错误';
    case 'CHARACTER_INVALID': return '修正 game.config.json 的角色表结构（name 必须非空）';
    case 'ENTRY_SCENE_MISSING': return '创建该入口场景或把 entryScene 改为存在的场景';
    case 'SPEAKER_UNRESOLVED': return '创建对应角色（character.ensure）或修正台词 speaker';
    case 'TIMELINE_ID_MISMATCH': return '把 definition.id 改为与文件名 stem 一致（或重命名文件并同步场景引用）';
    case 'TIMELINE_ID_DUPLICATE': return '为冲突文件分配唯一的 canonical ID（文件名 stem == definition.id）';
    default: return `修正 ${code} 对应的源码问题`;
  }
}

function objectRefFor(index: ObjectIndex, issue: LintIssue): string | undefined {
  // JSON declarations share synthetic line 1; it does not identify one field.
  if (issue.file === 'game.config.json') return undefined;
  const candidates = index.objects.filter((object) => (
    object.source?.path === issue.file && object.source.line === issue.line
  ));
  return candidates.find((object) => object.kind === 'choice-option')?.objectRef
    ?? candidates[0]?.objectRef;
}

function enrich(index: ObjectIndex, issue: LintIssue & { objectRef?: string }): AuthoringValidationIssue {
  const objectRef = issue.objectRef ?? objectRefFor(index, issue);
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
  const rawIssues: Array<LintIssue & { objectRef?: string }> = [];
  const firstSceneById = new Map<string, typeof snapshot.scenes[number]>();
  const scenes = new Map<string, CompiledScene>();
  for (const physicalScene of snapshot.scenes) {
    if (!isValidSceneId(physicalScene.id)) {
      rawIssues.push({
        severity: 'error',
        code: 'SCENE_ID',
        text: `${physicalScene.path}:1:1: 场景 ID '${physicalScene.id}' 非法；sceneId.label 寻址不允许 scene ID 含点号`,
        file: physicalScene.path,
        line: 1,
        col: 1,
      });
    }
    const first = firstSceneById.get(physicalScene.id);
    if (first !== undefined) {
      rawIssues.push({
        severity: 'error',
        code: 'LINT_DUP',
        text: `${physicalScene.path}:1:1: 场景 ID '${physicalScene.id}' 与 ${first.path} 重复；两个物理文件必须使用唯一 ID`,
        file: physicalScene.path,
        line: 1,
        col: 1,
      });
      continue;
    }
    firstSceneById.set(physicalScene.id, physicalScene);
    scenes.set(physicalScene.id, physicalScene.compiled);
  }
  const labels = new Map([...scenes.entries()].map(([id, scene]) => [id, new Set(scene.labels.keys())]));
  const failedScenes = new Set(options.failedScenes ?? []);
  const configPath = snapshot.configFile?.path ?? 'game.config.json';
  const parsed = parseVariableConfig(snapshot.config, configPath, rawIssues);

  for (const physicalScene of snapshot.scenes) {
    const scene = physicalScene.compiled;
    for (const diagnostic of scene.diagnostics) {
      rawIssues.push({
        severity: 'warning',
        code: diagnostic.code,
        text: `${diagnostic.file}:${diagnostic.line}:${diagnostic.col}: ${diagnostic.message}${diagnostic.hint ? `（${diagnostic.hint}）` : ''} [${diagnostic.code}]`,
        file: diagnostic.file,
        line: diagnostic.line,
        col: diagnostic.col,
        ...(diagnostic.range ? { range: diagnostic.range } : {}),
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

  for (const physicalScene of snapshot.scenes) {
    const sceneId = physicalScene.id;
    const scene = physicalScene.compiled;
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
        objectRef: `character:${id}`,
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
    if (options.assetCatalog !== undefined && typeof avatar === 'string' && avatar.trim().length > 0 && !resolvedAvatars.has(avatar.trim())) {
      rawIssues.push({
        severity: 'warning',
        code: 'ASSET_UNRESOLVED',
        text: `${configPath}: 角色 '${id}' 的头像资源 '${avatar}' 未解析（catalog 中不存在或格式不受支持）`,
        objectRef: `character:${id}`,
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
      objectRef: 'config:entryScene',
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
  // Phase 2B（A2）：canonical identity = filename stem == definition.id（共享 timeline-identity helper）。
  // mismatch 文件仍是 filename presence（不新增误导 MISSING），但不是 identity-valid，绝不进入 usable。
  const parsedTimelineNames = new Set<string>();
  const usableTimelineDefinitions = new Map<string, TimelineDefinition>();
  const internalIdFirstFile = new Map<string, string>();
  for (const timeline of snapshot.timelines) {
    const name = timelineIdFromPath(timeline.path);
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
    // 跨文件内部身份争夺：不同文件声明相同 string definition.id 时立即给出两个冲突路径，
    // 不等 runtime loader 才第一次发现。
    const internalId = (definition as { id?: unknown }).id;
    if (typeof internalId === 'string') {
      const firstFile = internalIdFirstFile.get(internalId);
      if (firstFile === undefined) {
        internalIdFirstFile.set(internalId, timeline.path);
      } else {
        rawIssues.push({
          severity: 'error',
          code: 'TIMELINE_ID_DUPLICATE',
          text: `${firstFile} 与 ${timeline.path}: 两个时间轴文件使用相同的 definition.id '${internalId}'（canonical ID 必须与文件名 stem 一致）`,
          file: timeline.path,
          line: 1,
          col: 1,
        });
      }
    }
    // canonical identity 检查（id 为字符串才比较；结构非法 id 由 validateTimeline 的 T0xx 负责）。
    const conflict = timelineIdentityConflict(timeline.path, definition);
    if (conflict !== null) {
      rawIssues.push({
        severity: 'error',
        code: 'TIMELINE_ID_MISMATCH',
        text: timelineIdentityMismatchMessage(conflict),
        file: timeline.path,
        line: 1,
        col: 1,
      });
    }
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
    if (conflict === null && diagnostics.length === 0) usableTimelineDefinitions.set(name, definition);
  }

  // @timeline 指令的目标存在性（Phase 2C：显式 scope，默认 complete——不得再用 timeline 数量猜 scope）。
  // 依据 parsedTimelineNames：结构非法但 parse 成功的文件仍视为存在（与 A1 修复前语义一致，
  // 其结构问题已由 T0xx error 单独报告）；parse 失败的文件名不在集合中（同样与修复前一致）。
  if ((options.timelineReferenceScope ?? 'complete') === 'complete') {
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
    // 编译结果包含 choice 的内联指令块，复用真实运行参数而非另扫 DSL 文本。
    const unquote = (value: string): string => value.length >= 2
      && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0] ? value.slice(1, -1) : value;
    for (const scene of scenes.values()) {
      for (const instruction of scene.instructions) {
        if (instruction.op !== 'instr' || !['bg', 'show'].includes(instruction.name)) continue;
        const key = unquote(instruction.args[0] ?? '');
        if (!key) continue;
        const target = key.includes(':') ? key : `${key}:normal`;
        const expression = unquote(instruction.args[1] ?? 'normal');
        if (instruction.name === 'bg' ? resolvedBackgrounds.has(key) : resolvedPortraits.has(`${target}:${expression}`)) continue;
        rawIssues.push({ severity: 'warning', code: 'ASSET_UNRESOLVED',
          text: `${instruction.file}:${instruction.line}: ${instruction.name === 'bg' ? '背景' : '立绘'}资源 '${key}'${instruction.name === 'show' ? ` / ${expression}` : ''} 未解析`,
          file: instruction.file, line: instruction.line, col: instruction.col });
      }
    }
    for (const timeline of snapshot.timelines) {
      // 仅 identity-valid 且结构可用的 definition 参与 asset traversal（Phase 2A/2B）。
      const definition = usableTimelineDefinitions.get(timelineIdFromPath(timeline.path));
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

  const galleryFile = snapshot.files.find((file) => file.path === GALLERY_PATH);
  const terminologyFile = snapshot.files.find(file => file.path === 'content/config/terminology.json');
  let terminology: unknown;
  try { if (terminologyFile) terminology = parseProjectConfigDocument(terminologyFile.text, terminologyFile.path); }
  catch (error) { rawIssues.push({ severity: 'error', code: 'G001', text: `名词表解析失败：${String(error)}`, file: terminologyFile!.path, line: 0, col: 0 }); }
  rawIssues.push(...validateGalleryConfig({
    text: galleryFile?.text ?? '{"cgs":[],"music":[]}',
    galleryPath: GALLERY_PATH, scenes, failedSceneIds: failedScenes, characters: (snapshot.config.characters ?? {}) as Record<string, unknown>, configPath,
    terminology,
    variables: snapshot.variables,
    ...(assetCatalog === undefined ? {} : { bgAssets: new Set(assetCatalog.backgrounds.filter((entry) => entry.resolved).map((entry) => entry.key)) }),
  }));
  rawIssues.push(...validateProjectStageContent(snapshot, options.assetCatalog));
  try {
    const theme = resolveProjectTheme(snapshot.config);
    const logo = resolveProjectTitleLogo(snapshot.config);
    if (options.assetCatalog) validateThemeAssetBindings(theme, logo, options.assetCatalog);
  } catch (error) {
    rawIssues.push({ severity: 'error', code: 'THEME_INVALID', text: error instanceof Error ? error.message : String(error), file: configPath, line: 1, col: 1 });
  }
  try {
    const ui = readProjectUi(snapshot.config);
    if (options.assetCatalog) validateUiAssets(ui, options.assetCatalog);
  } catch (error) {
    rawIssues.push({ severity: 'error', code: 'UI_INVALID', text: error instanceof Error ? error.message : String(error), file: configPath, line: 1, col: 1 });
  }
  try {
    for (const key of staleTextCatalogKeys(snapshot)) {
      rawIssues.push({ severity: 'warning', code: 'TEXT_SOURCE_STALE',
        text: `译稿 ${key} 的来源版本或对应关系变化，请明确重新绑定；旧译稿保留，未自动配给其他台词。`, file: configPath, line: 1, col: 1 });
    }
    const catalog = readTextCatalog(snapshot.config);
    for (const entry of catalog?.entries ?? []) for (const [locale, voice] of Object.entries(entry.voices ?? {})) {
      if (options.assetCatalog && options.assetCatalog.intelligence.items.filter(item => item.kind === 'voice' && item.key === voice.asset && item.physical && item.issues.every(issue => issue === 'ASSET_UNUSED')).length !== 1) {
        rawIssues.push({ severity: 'error', code: 'TEXT_VOICE_ASSET_INVALID', text: `对白 ${entry.key} 的 ${locale} 配音素材不可用或不唯一：${voice.asset}`, file: configPath, line: 1, col: 1 });
      }
      if (voice.sourceVersion !== entry.source.version || voice.text !== textCatalogEntryText(entry, locale, catalog!.sourceLocale)) {
        rawIssues.push({ severity: 'warning', code: 'TEXT_VOICE_STALE', text: `对白 ${entry.key} 的 ${locale} 配音对应台词已变化，旧绑定保留但不播放，请核对后重新确认。`, file: configPath, line: 1, col: 1 });
      }
    }
  } catch (error) {
    rawIssues.push({ severity: 'error', code: 'TEXT_CATALOG_INVALID', text: error instanceof Error ? error.message : String(error), file: configPath, line: 1, col: 1 });
  }
  attachHints(rawIssues);
  const issues = rawIssues.map((issue) => enrich(index, issue));
  return {
    issues,
    scenes,
    ok: issues.every((issue) => issue.severity !== 'error'),
  };
}
