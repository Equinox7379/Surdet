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
import { buildObjectIndex } from './object-index.js';
import type { ProjectSnapshot } from './project-snapshot.js';

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
}

function actionFor(code: string): string {
  switch (code) {
    case 'J002': return '创建或修正标签，再重新校验该跳转';
    case 'J001': return '创建目标场景或修正跳转目标';
    case 'J003': return '先修复目标场景的语法或结构错误';
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

  attachHints(rawIssues);
  const issues = rawIssues.map((issue) => enrich(index, issue));
  return {
    issues,
    scenes,
    ok: issues.every((issue) => issue.severity !== 'error'),
  };
}
