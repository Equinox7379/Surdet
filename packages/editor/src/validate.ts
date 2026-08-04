/**
 * 项目级校验：与 CLI lint 同源——场景编译、变量/类型/修饰符/choice 嗅探等检查
 * 全部复用 @surdet/core 的 scene-lint 共享实现（消除双源逻辑漂移）。
 * 编辑器额外提供：场景 ID（basename）重复检测（对齐 CLI LINT_DUP）与 @scene 一致性。
 */
import {
  compileScene,
  SourceError,
  parseVariableConfig,
  checkChoiceSuspects,
  collectSceneSpeakers,
  checkConsumedModifiers,
  validateSceneVariables,
  validateSwitchTargets,
  validateJumpTarget,
} from '@surdet/core';
import type { CompiledScene, JumpInstr, CallInstr, LintIssue } from '@surdet/core';

export type Issue = LintIssue;

export interface SceneSource {
  /** 唯一 key（相对路径，如 'sub/ch01'；子目录同名文件互不覆盖） */
  key: string;
  /** 场景 ID（basename；引擎运行时语义；重复即 LINT_DUP） */
  id: string;
  /** 用于报错展示的文件名 */
  file: string;
  source: string;
}

export interface ProjectConfig {
  /** 解析后的 game.config.json 原始对象（null = 无配置） */
  raw: Record<string, unknown> | null;
  /** 配置展示名（报错定位用） */
  path: string;
}

export interface ValidateResult {
  issues: Issue[];
  /** 编译成功的场景（供引用分析/图谱） */
  scenes: Map<string, CompiledScene>;
}

export function validateProject(
  sceneSources: SceneSource[],
  entryScene?: string,
  config?: ProjectConfig,
): ValidateResult {
  const issues: Issue[] = [];
  const compiled = new Map<string, CompiledScene>();
  const labels = new Map<string, Set<string>>();
  const failedScenes = new Set<string>();

  // 配置解析（共享实现）：变量表/类型表/readonly 集/customInstructions + 声明形状校验
  let variables = new Set<string>();
  let types = new Map<string, string>();
  let readonlyVars = new Set<string>();
  let customInstructions: string[] = [];
  let hasConfig = false;
  if (config && config.raw) {
    hasConfig = true;
    const parsed = parseVariableConfig(config.raw, config.path, issues);
    variables = parsed.variables;
    types = parsed.types;
    readonlyVars = parsed.readonlyVars;
    customInstructions = parsed.customInstructions;
  }

  // 场景 ID（basename）重复检测（对齐 CLI LINT_DUP：运行时 sceneId = 文件名去扩展名）
  const idFirstFile = new Map<string, string>();

  for (const sc of sceneSources) {
    const firstFile = idFirstFile.get(sc.id);
    if (firstFile !== undefined) {
      issues.push({
        severity: 'error',
        code: 'LINT_DUP',
        text: `${sc.file}: 场景 ID '${sc.id}' 与 ${firstFile} 重复（场景 ID = 文件名去扩展名，必须全局唯一；保存时两者会互相覆盖）`,
        file: sc.file,
        line: 0,
        col: 0,
      });
      continue;
    }
    idFirstFile.set(sc.id, sc.file);
    if (sc.id.includes('.')) {
      issues.push({
        severity: 'error',
        code: 'SCENE_ID',
        text: `${sc.file}: 场景 ID '${sc.id}' 含点号，会破坏 @jump 目标寻址（sceneId.label 按第一个点切分），请重命名文件`,
        file: sc.file,
        line: 0,
        col: 0,
      });
    }

    try {
      const scene = compileScene(sc.source, sc.file, sc.id, customInstructions);
      compiled.set(sc.id, scene);
      labels.set(sc.id, new Set(scene.labels.keys()));
      for (const d of scene.diagnostics) {
        issues.push({
          severity: 'warning',
          code: d.code,
          text: `${d.file}:${d.line}:${d.col}: ${d.message}${d.hint ? `（${d.hint}）` : ''} [${d.code}]`,
          file: d.file,
          line: d.line,
          col: d.col,
        });
      }
      // 场景级共享检查（与 CLI 同源）
      validateSwitchTargets(scene, issues);
      validateSceneVariables(scene, variables, types, readonlyVars, issues, hasConfig);
      checkChoiceSuspects(scene, collectSceneSpeakers(scene), issues);
      for (const instr of scene.instructions) {
        if (instr.op === 'instr') {
          checkConsumedModifiers(instr, issues);
          if (instr.name === 'scene') {
            const declared = instr.args[0];
            if (declared !== undefined && declared !== sc.id) {
              issues.push({
                severity: 'error',
                code: 'SCENE_ID',
                text: `${instr.file}:${instr.line}:${instr.col}: @scene 声明 '${declared}' 与文件名推导的场景 ID '${sc.id}' 不一致`,
                file: instr.file,
                line: instr.line,
                col: instr.col,
              });
            }
          }
        }
      }
    } catch (err) {
      failedScenes.add(sc.id);
      labels.set(sc.id, new Set());
      if (err instanceof SourceError) {
        const p = err.pos;
        issues.push({
          severity: 'error',
          code: err.code ?? 'LINT',
          text: err.message,
          file: p?.file ?? sc.file,
          line: p?.line ?? 0,
          col: p?.col ?? 0,
        });
      } else {
        issues.push({ severity: 'error', code: 'LINT', text: String(err), file: sc.file, line: 0, col: 0 });
      }
    }
  }

  // 跨场景 jump/call 目标校验（共享实现）
  for (const [sceneId, scene] of compiled) {
    for (const instr of scene.instructions) {
      if (instr.op === 'jump' && instr.kind === 'jump') {
        validateJumpTarget(sceneId, instr as JumpInstr, labels, failedScenes, issues);
      }
      if (instr.op === 'call') {
        validateJumpTarget(sceneId, instr as CallInstr, labels, failedScenes, issues, '@call');
      }
    }
  }

  // 未使用标签（W006）
  const localRefs = new Map<string, Set<string>>();
  const crossRefs = new Set<string>();
  for (const [sceneId, scene] of compiled) {
    const refs = new Set<string>();
    localRefs.set(sceneId, refs);
    for (const instr of scene.instructions) {
      if (instr.op === 'jump' && instr.kind === 'goto' && instr.target.length > 0) refs.add(instr.target);
      if (instr.op === 'switch') for (const c of instr.cases) refs.add(c.label);
      if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
        const t = (instr as JumpInstr | CallInstr).target;
        const dot = t.indexOf('.');
        if (dot >= 0) crossRefs.add(t);
      }
    }
  }
  for (const [sceneId, scene] of compiled) {
    const refs = localRefs.get(sceneId)!;
    for (const [label, idx] of scene.labels) {
      if (refs.has(label) || crossRefs.has(`${sceneId}.${label}`)) continue;
      const instr = scene.instructions[idx];
      issues.push({
        severity: 'warning',
        code: 'W006',
        text: `${instr ? `${instr.file}:${instr.line}:${instr.col}: ` : ''}标签 '@label ${label}' 从未被任何 @goto/@loop/@switch/@jump/@call 引用`,
        file: instr?.file ?? sceneId,
        line: instr?.line ?? 0,
        col: instr?.col ?? 0,
      });
    }
  }

  // 场景可达性（W007，需 entryScene）
  if (entryScene && compiled.has(entryScene)) {
    const adj = new Map<string, Set<string>>();
    for (const [sceneId, scene] of compiled) {
      const out = new Set<string>();
      adj.set(sceneId, out);
      for (const instr of scene.instructions) {
        if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
          const t = (instr as JumpInstr | CallInstr).target;
          const dot = t.indexOf('.');
          out.add(dot >= 0 ? t.slice(0, dot) : t);
        }
      }
    }
    const seen = new Set<string>([entryScene]);
    const queue = [entryScene];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nx of adj.get(cur) ?? []) {
        if (!seen.has(nx) && compiled.has(nx)) { seen.add(nx); queue.push(nx); }
      }
    }
    for (const sceneId of compiled.keys()) {
      if (!seen.has(sceneId)) {
        const first = compiled.get(sceneId)!.instructions[0];
        issues.push({
          severity: 'warning',
          code: 'W007',
          text: `${first ? `${first.file}: ` : ''}场景 '${sceneId}' 从入口场景 '${entryScene}' 不可达（无 @jump/@call 引用）`,
          file: first?.file ?? sceneId,
          line: first?.line ?? 0,
          col: first?.col ?? 0,
        });
      }
    }
  }

  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return { issues, scenes: compiled };
}
