/**
 * 项目级校验：与 CLI lint 同源——场景编译、变量/类型/修饰符/choice 嗅探等检查
 * 全部复用 @surdet/core 的 scene-lint 共享实现（消除双源逻辑漂移）。
 * 编辑器额外提供：场景 ID（basename）重复检测（对齐 CLI LINT_DUP）与 @scene 一致性。
 */
import {
  compileScene,
  SourceError,
} from '@surdet/core';
import type { CompiledScene, JumpInstr, CallInstr, LintIssue } from '@surdet/core';
import {
  buildObjectIndex,
  parseSceneDocument,
  validateSnapshot,
} from '@surdet/authoring';

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

function validationDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function compileConfigForCustomInstructions(raw: Record<string, unknown>, _path: string): string[] {
  const custom = raw['customInstructions'];
  return Array.isArray(custom) && custom.every((value) => typeof value === 'string')
    ? custom as string[]
    : [];
}

export function validateProject(
  sceneSources: SceneSource[],
  entryScene?: string,
  config?: ProjectConfig,
): ValidateResult {
  const issues: Issue[] = [];
  const compiled = new Map<string, CompiledScene>();
  const failedScenes = new Set<string>();

  // 配置解析（共享实现）：变量表/类型表/readonly 集/customInstructions + 声明形状校验
  let customInstructions: string[] = [];
  if (config && config.raw) {
    const parsed = compileConfigForCustomInstructions(config.raw, config.path);
    customInstructions = parsed;
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
    } catch (err) {
      failedScenes.add(sc.id);
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

  const sharedFiles = [...sceneSources].filter((source) => compiled.has(source.id)).map((source) => ({
    path: source.file,
    text: source.source,
    bytes: source.source.length,
    sha256: validationDigest(source.source),
  }));
  const configFile = config?.raw === undefined || config?.raw === null ? null : {
    path: config.path,
    text: JSON.stringify(config.raw),
    bytes: JSON.stringify(config.raw).length,
    sha256: validationDigest(JSON.stringify(config.raw)),
  };
  const configRaw = config?.raw ?? {};
  const configVariables = typeof configRaw['variables'] === 'object' && configRaw['variables'] !== null && !Array.isArray(configRaw['variables'])
    ? configRaw['variables'] as Record<string, unknown>
    : {};
  const sharedSnapshot = {
    rootIdentity: 'editor-validation',
    revision: validationDigest(sharedFiles.map((file) => `${file.path}\0${file.sha256}`).join('\n')),
    files: configFile === null ? sharedFiles : [...sharedFiles, configFile],
    configFile,
    config: configRaw,
    ...(typeof configRaw['entryScene'] === 'string' ? { entryScene: configRaw['entryScene'] } : entryScene === undefined ? {} : { entryScene }),
    variables: configVariables,
    scenes: [...compiled.entries()].map(([id, scene]) => {
      const source = sceneSources.find((candidate) => candidate.id === id && candidate.file === scene.instructions[0]?.file)
        ?? sceneSources.find((candidate) => candidate.id === id)!;
      const file = sharedFiles.find((candidate) => candidate.path === source.file)!;
      return { id, path: source.file, file, document: parseSceneDocument(source.source), compiled: scene };
    }),
    timelines: [],
  };
  const shared = validateSnapshot(sharedSnapshot, buildObjectIndex(sharedSnapshot), { failedScenes });
  issues.push(...shared.issues);

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
