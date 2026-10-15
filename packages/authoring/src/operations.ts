import { patchStageSourceLine } from './stage-source-patch.js';
import { assertProjectTargetNamespace } from './scene-relocation.js';
import { collectConfigSceneRoots, compileScene, isValidSceneId, isReservedSceneFileId, Lexer, Parser, findChoiceArrow, splitOutsideQuotes, parseInlineInstructions, resolveProjectFontPaths, resolveProjectTitleLogo, type AstBlock } from '@surdet/core';
import {
  insertLinesAfter,
  parseSceneDocument,
  parseSceneLine,
  parseSceneStructure,
  rebuildTextRaw,
  serializeSceneDocument,
  splitInstruction,
  instructionArgumentSpans,
  type SceneConditionBranchStructure,
  type SceneConditionStructure,
  type SceneStructureSpan,
} from './scene-document.js';
import type {
  SceneChoiceOptionInput,
  SceneBlockInput,
  SceneCreateInput,
  SceneRemoveInput,
  SceneDocumentLineInput,
  SceneDocumentLine,
  ScenePatchInput,
  ScenePatchOperation,
  SceneConditionPatchBranchInput,
  SceneEol,
  VariableEnsureInput,
  TextHasher,
  ProjectReferenceRename,
} from './contracts.js';
import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import { normalizeProjectPath } from './project-storage.js';
import { buildSceneOperationCompositionDraft, buildVariableOperationCompositionDraft, compositionTextHasher } from './operation-composition-facts.js';
import { REPLACEABLE_SCENE_INSTRUCTIONS } from './contracts.js';
import { resolveUniqueScenarioPath, sceneIdFromScenarioPath } from './scenario-identity.js';
import { GALLERY_PATH } from './gallery-operations.js';
import { analyzeSceneCompositionReferences } from './composition-reference-analysis.js';
import { inspectPlayerConfig } from './config-operations.js';
import { renameConfigReferences } from './scene-relocation.js';
import { assertTextCatalogTargetRemovable, renameTextCatalogReferences } from './text-catalog.js';

function sceneCharacters(config: Record<string, unknown>): Record<string, unknown> {
  const characters = config.characters;
  return typeof characters === 'object' && characters !== null && !Array.isArray(characters)
    ? characters as Record<string, unknown> : {};
}

/** Capture the current working configuration once for each scene operation. */
function sceneCompositionConfig(files: Record<string, string>) {
  const config = parseProjectConfigDocument(files['game.config.json'] ?? '{}');
  return {
    stageConfig: config.stage,
    themeConfig: config.theme,
    uiConfig: config.ui,
    textCatalog: config.textCatalog,
    terminologyText: files['content/config/terminology.json'],
    galleryText: files['content/config/gallery.json'],
    variables: config.variables as Record<string, unknown> | undefined,
    titleLogo: resolveProjectTitleLogo(config),
    characters: sceneCharacters(config),
    fontPaths: resolveProjectFontPaths(config),
  };
}

function scenePath(sceneId: string): string {
  if (!isValidSceneId(sceneId)) throw new AuthoringOperationError('PATH_OUTSIDE_PROJECT', `场景 ID 非法：${sceneId}`);
  return normalizeProjectPath(`content/scenario/${sceneId}.gal`);
}

function sceneCreationPath(sceneId: string): string {
  const path = scenePath(sceneId);
  if (isReservedSceneFileId(sceneId)) {
    throw new AuthoringOperationError('INVALID_REQUEST', '场景 ID 不能使用 Windows 设备名');
  }
  return path;
}

function assertSingleLine(value: string, field: string): void {
  if (/[\r\n\u2028\u2029]/.test(value)) {
    throw new AuthoringOperationError('INVALID_REQUEST', `${field} 不能包含换行`);
  }
}

function renderText(speaker: string, value: string, sep = '：', indent = '', previous = ''): SceneDocumentLineInput {
  if (/[\r\n]/.test(speaker) || /[\r\n]/.test(value)) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'typed text 不能包含 CR/LF 物理换行');
  }
  const raw = indent + rebuildTextRaw(speaker, value, sep);
  const parsed = parseSceneLine(raw, previous);
  if (parsed.kind !== 'text' || parsed.speaker !== speaker || parsed.value !== value) {
    throw new AuthoringOperationError('INVALID_REQUEST', '此正文无法原样表达为台词；请使用明确的 speaker，指令请通过 instruction 编排');
  }
  return parsed;
}

function renderChoiceOption(option: SceneChoiceOptionInput, indent = '  ', trailing = ''): string {
  assertSingleLine(option.label, 'choice option.label');
  if (option.when !== undefined && option.when !== null) assertSingleLine(option.when, 'choice option.when');
  for (const effect of option.effects ?? []) {
    assertSingleLine(effect.name, 'choice effect.name');
    for (const arg of effect.args) assertSingleLine(arg, 'choice effect.args');
  }
  assertSingleLine(option.target.kind, 'choice target.kind');
  assertSingleLine(option.target.value, 'choice target.value');
  let raw = `${indent}${option.label}`;
  if (option.when !== undefined && option.when !== null) raw += ` [if:${option.when}]`;
  raw += ' ->';
  for (const effect of option.effects ?? []) {
    raw += ` @${effect.name}${effect.args.length > 0 ? ` ${effect.args.join(' ')}` : ''}`;
  }
  raw += ` @${option.target.kind} ${option.target.value}`;
  return raw + trailing;
}

function renderBlocks(blocks: readonly SceneBlockInput[], indent = ''): SceneDocumentLineInput[] {
  const lines: SceneDocumentLineInput[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') {
      const speaker = block.speaker ?? '';
      const last = lines.at(-1);
      const previous = last?.kind === 'instr' && last.name === 'choice' ? 'choice' : last?.kind ?? '';
      lines.push(renderText(speaker, block.value, '：', indent, previous));
    } else if (block.kind === 'label') {
      assertSingleLine(block.name, 'label.name');
      lines.push({ kind: 'label', name: block.name, raw: `${indent}@label ${block.name}` });
    } else if (block.kind === 'instruction') {
      const args = block.args ?? [];
      assertSingleLine(block.name, 'instruction.name');
      for (const arg of args) assertSingleLine(arg, 'instruction.args');
      const modifiers = Object.entries(block.modifiers ?? {}).map(([name, value]) => `@${name}${value.length > 0 ? `=${value}` : ''}`);
      for (const [name, value] of Object.entries(block.modifiers ?? {})) {
        assertSingleLine(name, 'instruction.modifiers');
        assertSingleLine(value, 'instruction.modifiers');
      }
      const suffix = [...args, ...modifiers].join(' ');
      lines.push({ kind: 'instr', name: block.name, raw: `${indent}${suffix.length > 0 ? `@${block.name} ${suffix}` : `@${block.name}`}` });
    } else if (block.kind === 'choice') {
      lines.push({ kind: 'instr', name: 'choice', raw: `${indent}@choice` });
      for (const option of block.options) lines.push({ kind: 'choice-option', raw: renderChoiceOption(option, `${indent}  `) });
    } else {
      lines.push(...renderConditionBlock(block, indent));
    }
  }
  return lines;
}

function validateConditionBranches(
  branches: readonly { kind: string; expr?: string; blocks?: readonly SceneBlockInput[] }[],
): void {
  if (branches.length === 0 || branches[0]?.kind !== 'if') {
    throw new AuthoringOperationError('INVALID_REQUEST', 'condition 必须以 if 分支开始');
  }
  let sawElse = false;
  branches.forEach((branch, index) => {
    if (branch.kind !== 'if' && branch.kind !== 'elif' && branch.kind !== 'else') {
      throw new AuthoringOperationError('INVALID_REQUEST', `未知条件分支类型：${branch.kind}`);
    }
    if (index > 0 && branch.kind === 'if') {
      throw new AuthoringOperationError('INVALID_REQUEST', 'if 分支只能出现在 condition 开头');
    }
    if (branch.kind === 'else') {
      if (sawElse || index !== branches.length - 1) {
        throw new AuthoringOperationError('INVALID_REQUEST', 'else 分支必须最多一个且位于条件块末尾');
      }
      sawElse = true;
      if (branch.expr !== undefined) throw new AuthoringOperationError('INVALID_REQUEST', 'else 分支不能带条件表达式');
    } else if (typeof branch.expr !== 'string' || branch.expr.trim().length === 0) {
      throw new AuthoringOperationError('INVALID_REQUEST', `${branch.kind} 分支缺少条件表达式`);
    }
    if (branch.expr !== undefined) assertSingleLine(branch.expr, `${branch.kind} 分支 expr`);
    if (branch.blocks !== undefined && !Array.isArray(branch.blocks)) {
      throw new AuthoringOperationError('INVALID_REQUEST', `${branch.kind} 分支正文必须是 blocks 数组`);
    }
  });
}

function renderConditionHeader(kind: 'if' | 'elif' | 'else', expr: string | undefined, indent = '', trailing = ''): string {
  if (kind === 'else') return `${indent}@else${trailing}`;
  return `${indent}@${kind} ${expr ?? ''}${trailing}`;
}

function renderConditionBlock(
  block: Extract<SceneBlockInput, { kind: 'condition' }>,
  indent = '',
): SceneDocumentLineInput[] {
  validateConditionBranches(block.branches);
  const lines: SceneDocumentLineInput[] = [];
  for (const branch of block.branches) {
    lines.push({ kind: 'instr', name: branch.kind, raw: renderConditionHeader(branch.kind, branch.expr, indent) });
    lines.push(...renderBlocks(branch.blocks, `${indent}  `));
  }
  lines.push({ kind: 'instr', name: 'endif', raw: `${indent}@endif` });
  return lines;
}

function sceneIdFromTarget(target: string): string | undefined {
  if (target.startsWith('label:')) return /^label:([^.]+)\./.exec(target)?.[1];
  return /^scene:([^/]+)\//.exec(target)?.[1];
}

function lineNumberFromTarget(target: string): number | undefined {
  const match = /\/[^:]+:(\d+)@/.exec(target);
  const line = match?.[1];
  return line === undefined ? undefined : Number(line);
}

function fingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function previousKind(lines: readonly SceneDocumentLine[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const previous = lines[cursor]!;
    if (previous.kind === 'blank' || previous.kind === 'comment') continue;
    if (previous.kind === 'instr') return previous.name === 'choice' ? 'choice' : 'instr';
    if (previous.kind === 'choice-option') return 'choice-option';
    return previous.kind;
  }
  return '';
}

function defaultEol(lines: readonly SceneDocumentLine[]): Exclude<SceneEol, ''> {
  const found = lines.find((line) => line.eol.length > 0)?.eol;
  return found === undefined || found === '' ? '\n' : found;
}

function operationTarget(patch: ScenePatchOperation): string {
  if (patch.kind === 'insertAfter' || patch.kind === 'insertBefore') return patch.anchor;
  return patch.target;
}

function patchLineIndex(lines: readonly SceneDocumentLine[], patch: ScenePatchOperation): number {
  if (patch.kind === 'insertBefore' && patch.anchor.startsWith('label:')) {
    const name = patch.anchor.slice(patch.anchor.indexOf('.') + 1);
    const index = lines.findIndex(line => line.kind === 'label' && line.name === name);
    if (index < 0) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `标签不存在：${patch.anchor}`);
    return index;
  }
  const lineNumber = lineNumberFromTarget(operationTarget(patch));
  if (lineNumber === undefined || lineNumber < 1 || lineNumber > lines.length) {
    throw new AuthoringOperationError('OBJECT_NOT_FOUND', `无法从 objectRef 定位行：${operationTarget(patch)}`);
  }
  return lineNumber - 1;
}

function checkPatchPrecondition(lines: readonly SceneDocumentLine[], patch: ScenePatchOperation, index: number): void {
  const actual = lines[index];
  if (actual === undefined || fingerprint(actual.raw) !== patch.expectedFingerprint) {
    throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `对象原内容指纹不匹配：${operationTarget(patch)}`);
  }
}

function spanLines(lines: readonly SceneDocumentLine[], span: SceneStructureSpan): SceneDocumentLine[] {
  const start = Math.max(0, span.startLine - 1);
  const end = Math.max(start, span.endLine);
  return lines.slice(start, end);
}

function spanFingerprint(lines: readonly SceneDocumentLine[], span: SceneStructureSpan): string {
  return fingerprint(serializeSceneDocument(spanLines(lines, span), defaultEol(lines)));
}

function lineIndent(raw: string): string {
  return /^\s*/.exec(raw)?.[0] ?? '';
}

function lineTrailing(raw: string): string {
  return /[ \t]*$/.exec(raw)?.[0] ?? '';
}

function materializeInput(input: SceneDocumentLineInput, eol: Exclude<SceneDocumentLine['eol'], ''>): SceneDocumentLine {
  if (input.kind === 'text') return { ...input, sep: input.sep ?? '：', eol };
  return { ...input, eol };
}

function materializeInputs(
  inputs: readonly SceneDocumentLineInput[],
  eol: Exclude<SceneDocumentLine['eol'], ''>,
): SceneDocumentLine[] {
  return inputs.map((input) => materializeInput(input, eol));
}

function structuralTarget(
  target: string,
  kind: 'choice' | 'condition' | 'condition-branch',
): { sceneId: string; line: number; fingerprint: string } | null {
  const pattern = kind === 'choice'
    ? /^scene:([^/]+)\/choice:(\d+)@[^-]+-([0-9a-f]{8})$/
    : kind === 'condition'
      ? /^scene:([^/]+)\/condition:(\d+)@[^-]+-([0-9a-f]{8})$/
      : /^scene:([^/]+)\/condition-branch:(\d+)@[^-]+-([0-9a-f]{8})$/;
  const match = pattern.exec(target);
  if (match === null) return null;
  return { sceneId: match[1]!, line: Number(match[2]), fingerprint: match[3]! };
}

function structuralPreconditionError(target: string, reason: string): AuthoringOperationError {
  return new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `${reason}：${target}`);
}

function choiceStructureForTarget(
  lines: readonly SceneDocumentLine[],
  structures: ReturnType<typeof parseSceneStructure>,
  target: string,
  sceneId: string,
  expectedFingerprint: string,
): ReturnType<typeof parseSceneStructure>['choices'][number] {
  const parsed = structuralTarget(target, 'choice');
  if (parsed === null || parsed.sceneId !== sceneId) {
    throw structuralPreconditionError(target, 'replaceChoiceGroup 需要本场景的 choice 结构 objectRef');
  }
  const structure = structures.choices.find((candidate) => candidate.span.startLine === parsed.line);
  const header = lines[parsed.line - 1];
  if (structure === undefined || header?.kind !== 'instr' || header.name !== 'choice') {
    throw structuralPreconditionError(target, 'choice 结构已不存在或位置已变化');
  }
  if (fingerprint(header.raw) !== parsed.fingerprint) {
    throw structuralPreconditionError(target, 'choice 声明行原内容指纹不匹配');
  }
  const actual = spanFingerprint(lines, structure.span);
  if (actual !== expectedFingerprint || parsed.fingerprint.length === 0) {
    throw structuralPreconditionError(target, 'choice 完整结构指纹不匹配');
  }
  return structure;
}

function conditionStructureForTarget(
  lines: readonly SceneDocumentLine[],
  structures: ReturnType<typeof parseSceneStructure>,
  target: string,
  sceneId: string,
  expectedFingerprint: string,
): SceneConditionStructure {
  const parsed = structuralTarget(target, 'condition');
  if (parsed === null || parsed.sceneId !== sceneId) {
    throw structuralPreconditionError(target, 'replaceConditionBlock 需要本场景的 condition 结构 objectRef');
  }
  const structure = structures.conditions.find((candidate) => candidate.span.startLine === parsed.line);
  const header = lines[parsed.line - 1];
  if (structure === undefined || header?.kind !== 'instr' || header.name !== 'if') {
    throw structuralPreconditionError(target, 'condition 结构已不存在或位置已变化');
  }
  const actual = spanFingerprint(lines, structure.span);
  if (actual !== parsed.fingerprint || actual !== expectedFingerprint) {
    throw structuralPreconditionError(target, 'condition 完整结构指纹不匹配');
  }
  return structure;
}

function directBranchForTarget(
  lines: readonly SceneDocumentLine[],
  structure: SceneConditionStructure,
  target: string,
  sceneId: string,
): SceneConditionBranchStructure {
  const parsed = structuralTarget(target, 'condition-branch');
  if (parsed === null || parsed.sceneId !== sceneId) {
    throw structuralPreconditionError(target, 'sourceBranch 必须是当前 condition 的直接分支 objectRef');
  }
  const branch = structure.branches.find((candidate) => candidate.span.startLine === parsed.line);
  if (branch === undefined) {
    throw structuralPreconditionError(target, 'sourceBranch 不能引用嵌套或其他 condition 的分支');
  }
  const actual = spanFingerprint(lines, branch.span);
  if (actual !== parsed.fingerprint) {
    throw structuralPreconditionError(target, 'sourceBranch 分支内容指纹不匹配');
  }
  return branch;
}

function branchBodyIndent(
  lines: readonly SceneDocumentLine[],
  branch: SceneConditionBranchStructure | undefined,
  fallback: string,
): string {
  if (branch !== undefined) {
    for (const line of spanLines(lines, branch.bodySpan)) {
      if (line.raw.trim().length > 0) return lineIndent(line.raw);
    }
  }
  return fallback;
}

function validateChoicePayload(choice: Extract<SceneBlockInput, { kind: 'choice' }>): void {
  if (choice.kind !== 'choice' || !Array.isArray(choice.options)) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'choice 必须包含 options 数组');
  }
  for (const option of choice.options) {
    if (option === null || typeof option !== 'object' || typeof option.label !== 'string') {
      throw new AuthoringOperationError('INVALID_REQUEST', 'choice option 必须包含 label');
    }
    if (option.target === null || typeof option.target !== 'object'
      || (option.target.kind !== 'goto' && option.target.kind !== 'jump')
      || typeof option.target.value !== 'string') {
      throw new AuthoringOperationError('INVALID_REQUEST', 'choice option 必须包含 goto 或 jump target');
    }
  }
}

function replaceChoiceGroupLines(
  lines: readonly SceneDocumentLine[],
  structure: ReturnType<typeof parseSceneStructure>['choices'][number],
  choice: Extract<SceneBlockInput, { kind: 'choice' }>,
  eol: Exclude<SceneEol, ''>,
): SceneDocumentLine[] {
  validateChoicePayload(choice);
  const rangeStart = structure.span.startLine - 1;
  const rangeEnd = structure.span.endLine;
  const currentOptions = lines.slice(rangeStart, rangeEnd).filter((line) => line.kind === 'choice-option');
  const styleSource = currentOptions[0];
  const indent = styleSource === undefined ? '  ' : lineIndent(styleSource.raw);
  const trailing = styleSource === undefined ? '' : lineTrailing(styleSource.raw);
  const rendered = choice.options.map((option) => renderChoiceOption(option, indent, trailing));
  const replacement: SceneDocumentLine[] = [];
  let optionIndex = 0;
  for (let index = rangeStart; index < rangeEnd; index++) {
    const line = lines[index]!;
    if (line.kind !== 'choice-option') {
      replacement.push(line);
      continue;
    }
    const raw = rendered[optionIndex];
    optionIndex += 1;
    if (raw === undefined) continue;
    replacement.push({ ...line, raw });
  }
  if (optionIndex < rendered.length) {
    const insertionEol = currentOptions.at(-1)?.eol || eol;
    for (; optionIndex < rendered.length; optionIndex++) {
      const isFinalFileLine = rangeEnd === lines.length && optionIndex === rendered.length - 1;
      replacement.push({ kind: 'choice-option', raw: rendered[optionIndex]!, eol: isFinalFileLine ? currentOptions.at(-1)?.eol ?? '' : insertionEol });
    }
  }
  return [...lines.slice(0, rangeStart), ...replacement, ...lines.slice(rangeEnd)];
}

function replaceConditionBlockLines(
  lines: readonly SceneDocumentLine[],
  structure: SceneConditionStructure,
  condition: { kind: 'condition'; branches: readonly SceneConditionPatchBranchInput[] },
  eol: Exclude<SceneEol, ''>,
  sceneId: string,
): SceneDocumentLine[] {
  validateConditionBranches(condition.branches);
  const rootHeader = lines[structure.span.startLine - 1];
  const endif = lines[structure.span.endLine - 1];
  if (rootHeader === undefined || endif === undefined) {
    throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'condition 结构范围越界');
  }
  const rootIndent = lineIndent(rootHeader.raw);
  const rootTrailing = lineTrailing(rootHeader.raw);
  const defaultBodyIndent = branchBodyIndent(lines, structure.branches[0], `${rootIndent}  `);
  const usedSources = new Set<string>();
  const replacement: SceneDocumentLine[] = [];

  for (const branch of condition.branches) {
    let sourceBranch: SceneConditionBranchStructure | undefined;
    if (branch.sourceBranch !== undefined) {
      sourceBranch = directBranchForTarget(lines, structure, branch.sourceBranch, sceneId);
      if (usedSources.has(branch.sourceBranch)) {
        throw new AuthoringOperationError('INVALID_REQUEST', '同一 sourceBranch 不能在一个替换中重复使用');
      }
      usedSources.add(branch.sourceBranch);
    } else if (branch.blocks === undefined) {
      throw new AuthoringOperationError('INVALID_REQUEST', '新增 condition 分支必须提供 blocks；保留原文时请提供 sourceBranch');
    }

    const sourceHeader = sourceBranch === undefined ? rootHeader : lines[sourceBranch.span.startLine - 1];
    const headerIndent = sourceHeader === undefined ? rootIndent : lineIndent(sourceHeader.raw);
    const headerTrailing = sourceHeader === undefined ? rootTrailing : lineTrailing(sourceHeader.raw);
    const headerEol = sourceHeader?.eol || eol;
    const keepHeader = sourceBranch !== undefined
      && sourceHeader !== undefined
      && sourceBranch.kind === branch.kind
      && (branch.kind === 'else' || sourceBranch.expr === branch.expr);
    replacement.push({
      kind: 'instr',
      name: branch.kind,
      raw: keepHeader ? sourceHeader.raw : renderConditionHeader(branch.kind, branch.expr, headerIndent, headerTrailing),
      eol: headerEol,
    });

    if (branch.blocks === undefined && sourceBranch !== undefined) {
      replacement.push(...spanLines(lines, sourceBranch.bodySpan));
    } else {
      const bodyIndent = branchBodyIndent(lines, sourceBranch, defaultBodyIndent);
      replacement.push(...materializeInputs(renderBlocks(branch.blocks ?? [], bodyIndent), headerEol,));
    }
  }
  replacement.push(endif);
  const start = structure.span.startLine - 1;
  const end = structure.span.endLine;
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end)];
}

function validateSceneCandidate(path: string, sceneId: string, text: string): void {
  try {
    // Core is the shared GAL parser/compiler. Validate the complete candidate
    // before runOperation is allowed to persist any working state.
    compileScene(text, path, sceneId);
  } catch (error) {
    throw new AuthoringOperationError('INVALID_REQUEST', error instanceof Error ? error.message : String(error));
  }
}

export function rewriteLabelReferences(source: string, path: string, currentScene: string, targetScene: string, oldName: string, newName: string | undefined,
  references: Array<{ path: string; line?: number; kind: string; target: string }>): string {
  validateSceneCandidate(path, currentScene, source);
  const document = parseSceneDocument(source);
  const ast = new Parser().parse(new Lexer().tokenize(source, path), currentScene);
  const rewrite = (raw: string, name: string, args: string[], line: number): string => {
    const replacements = new Map<number, string>();
    const reference = (argument: number, target: string, replacement: string) => {
      references.push({ path, line, kind: name, target });
      replacements.set(argument, replacement);
    };
    if ((name === 'goto' || name === 'loop') && currentScene === targetScene && args.join(' ') === oldName) {
      if (args.length !== 1) throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '无法精确定位标签参数', { path, line });
      reference(0, oldName, newName ?? oldName);
    } else if ((name === 'jump' || name === 'call') && args.join(' ') === `${targetScene}.${oldName}`) {
      if (args.length !== 1) throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '无法精确定位跨场景标签参数', { path, line });
      reference(0, args[0]!, `${targetScene}.${newName ?? oldName}`);
    } else if (name === 'switch' && currentScene === targetScene) {
      args.slice(1).forEach((arg, index) => {
        const colon = arg.indexOf(':');
        if (colon >= 0 && arg.slice(colon + 1) === oldName) reference(index + 1, oldName, arg.slice(0, colon + 1) + (newName ?? oldName));
      });
    }
    if (newName === undefined || replacements.size === 0) return raw;
    const spans = instructionArgumentSpans(raw);
    for (const [index, replacement] of [...replacements].sort(([left], [right]) => right - left)) {
      const span = spans[index];
      if (span === undefined || span.raw !== args[index]) throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '参数位置与 Core 语义不一致，不能安全改名', { path, line });
      // Flow targets retain quotes literally in Core; do not use the asset
      // argument encoder, which would silently change label identity.
      raw = raw.slice(0, span.start) + replacement + raw.slice(span.end);
    }
    return raw;
  };
  const visit = (blocks: readonly AstBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === 'if') { for (const branch of block.branches) visit(branch.blocks); }
      else if (block.kind === 'instr') {
        const row = document[block.pos.line - 1]!;
        row.raw = rewrite(row.raw, block.name, block.args, block.pos.line);
      } else if (block.kind === 'choice') {
        for (const option of block.options) {
          const row = document[option.pos.line - 1]!;
          const arrow = findChoiceArrow(row.raw, { file: path, line: option.pos.line, col: 1 });
          if (arrow === null) continue;
          let jumpSeen = false;
          const segments = splitOutsideQuotes(row.raw.slice(arrow.end), '@');
          for (let index = 1; index < segments.length; index++) {
            const raw = `@${segments[index]!}`;
            const instruction = parseInlineInstructions(raw, path, option.pos.line, option.pos.col)[0];
            if (instruction === undefined) continue;
            if (instruction.name === 'goto' || instruction.name === 'jump') {
              if (jumpSeen) continue; // Core deliberately ignores subsequent jumps in one choice.
              jumpSeen = true;
            }
            segments[index] = rewrite(raw, instruction.name, instruction.args, option.pos.line).slice(1);
          }
          row.raw = row.raw.slice(0, arrow.end) + segments.join('@');
        }
      }
    }
  };
  visit(ast.blocks);
  return serializeSceneDocument(document, defaultEol(document));
}

/** Shared source generation for typed creation and confirmed Editor imports. */
export function createSceneText(sceneId: string, blocks: readonly SceneBlockInput[] = []): string {
  sceneCreationPath(sceneId);
  const bodyLines: SceneDocumentLine[] = renderBlocks(blocks).map(line => line.kind === 'text'
    ? { ...line, sep: line.sep ?? '：', eol: '\n' as const } : { ...line, eol: '\n' as const });
  const lines: SceneDocumentLine[] = [{ kind: 'instr', name: 'scene', raw: `@scene ${sceneId}`, eol: '\n' }, ...bodyLines];
  const last = bodyLines.at(-1);
  if (last?.kind !== 'instr' || last.name !== 'end') lines.push({ kind: 'instr', name: 'end', raw: '@end', eol: '\n' });
  return serializeSceneDocument(lines);
}

export async function applySceneCreate(change: ChangeSession, input: SceneCreateInput, hasher: TextHasher = compositionTextHasher, sealedFingerprint?: string): Promise<{ sceneId: string; path: string }> {
  const path = sceneCreationPath(input.sceneId);
  return runOperation(change, input, async (record) => {
    assertProjectTargetNamespace(path, Object.keys(record.workingFiles));
    if (resolveUniqueScenarioPath(record.workingFiles, input.sceneId) !== undefined
      || Object.keys(record.workingFiles).some(file => file.startsWith('content/scenario/') && file.toLowerCase().endsWith('.gal')
        && sceneIdFromScenarioPath(file).toLowerCase() === input.sceneId.toLowerCase())) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `场景已存在：${input.sceneId}`);
    }
    let text = createSceneText(input.sceneId, input.blocks);
    const last = input.blocks?.at(-1);
    if (sealedFingerprint !== undefined && await hasher.sha256(text) !== sealedFingerprint) {
      // Older sealed creates always appended @end, including after an explicit one.
      // Preserve only that exact historical output; never rewrite a capsule or guess other repairs.
      const previousText = text + '@end\n';
      if (last?.kind !== 'instruction' || last.name !== 'end' || await hasher.sha256(previousText) !== sealedFingerprint) {
        throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `场景创建结果与封存指纹不匹配：${input.sceneId}`);
      }
      text = previousText;
    }
    validateSceneCandidate(path, input.sceneId, text);
    return {
      result: { sceneId: input.sceneId, path },
      compositionDraft: await buildSceneOperationCompositionDraft({
        capabilityId: 'scene.create', sceneId: input.sceneId, path, afterText: text,
        ...sceneCompositionConfig(record.workingFiles), hasher,
      }),
      workingFiles: { ...record.workingFiles, [path]: text },
    };
  });
}

export async function applySceneRemove(change: ChangeSession, input: SceneRemoveInput, hasher: TextHasher = compositionTextHasher) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '场景删除只支持普通 direct 草稿，不进入候选或组合结果', { operationApplied: false, operationId: input.operationId });
  }
  scenePath(input.sceneId);
  return runOperation(change, input, async (record) => {
    const path = resolveUniqueScenarioPath(record.workingFiles, input.sceneId);
    if (path === undefined) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `场景不存在：${input.sceneId}`);
    const source = record.workingFiles[path]!;
    const fingerprint = await hasher.sha256(source);
    if (fingerprint !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '场景正文已变化，请重新读取 object.inspect');

    const references: Array<{ path: string; line?: number; kind: string; target: string }> = [];
    const config = parseProjectConfigDocument(record.workingFiles['game.config.json'] ?? '{}');
    const scenes = Object.keys(record.workingFiles).filter(file => file.startsWith('content/scenario/') && file.toLowerCase().endsWith('.gal')).sort();
    assertTextCatalogTargetRemovable(config, input.sceneId);
    const entryScene = typeof config['entryScene'] === 'string' && config['entryScene'].length > 0
      ? config['entryScene'] : sceneIdFromScenarioPath(scenes[0]!);
    if (entryScene === input.sceneId) references.push({ path: 'game.config.json', kind: 'entryScene', target: input.sceneId });
    if ((await inspectPlayerConfig(config, hasher)).values.endScenes?.includes(input.sceneId)) {
      references.push({ path: 'game.config.json', kind: 'player.endScenes', target: input.sceneId });
    }
    for (const file of scenes) {
      if (file === path) continue; // The removed file's own references disappear with it.
      try {
        for (const ref of analyzeSceneCompositionReferences({ sceneId: sceneIdFromScenarioPath(file), path: file, text: record.workingFiles[file]!, characters: sceneCharacters(config) })) {
          if (ref.kind === 'scene' && ref.objectRef === `scene:${input.sceneId}`) {
            references.push({ path: file, line: ref.source.line, kind: 'scene', target: ref.token });
          }
        }
      } catch {
        throw new AuthoringOperationError('PROJECT_INVALID', `无法安全分析场景引用：${file}；请先修正剧本`, { path: file, operationApplied: false });
      }
    }
    for (const kind of ['events', 'growth', 'calendar'] as const) {
      const file = `content/config/${kind}.json`;
      const raw = record.workingFiles[file];
      if (raw === undefined) continue;
      const roots = collectConfigSceneRoots({ [kind]: parseProjectConfigDocument(raw, file) });
      for (const target of roots) {
        if (target.split('.')[0] === input.sceneId) references.push({ path: file, kind, target });
      }
    }
    const gallery = record.workingFiles[GALLERY_PATH];
    if (gallery !== undefined) {
      const texts = parseProjectConfigDocument(gallery, GALLERY_PATH)['texts'];
      if (texts !== undefined && !Array.isArray(texts)) throw new AuthoringOperationError('PROJECT_INVALID', `${GALLERY_PATH} 的 texts 必须是数组`);
      for (const item of texts as Array<{ scene?: unknown; id?: unknown }> | undefined ?? []) {
        if (item?.scene === input.sceneId) references.push({ path: GALLERY_PATH, kind: 'gallery.texts', target: String(item.id ?? input.sceneId) });
      }
    }
    if (references.length > 0) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `场景仍被引用，未删除：${input.sceneId}`, { operationApplied: false, references });
    }
    const workingFiles = { ...record.workingFiles };
    delete workingFiles[path];
    return { result: { sceneId: input.sceneId, path, removed: true }, workingFiles };
  });
}

export function renameGalleryLabel(source: string, sceneId: string, oldName: string, newName?: string,
  references?: Array<{ path: string; line?: number; kind: string; target: string }>): string {
  const gallery = parseProjectConfigDocument(source, GALLERY_PATH);
  if (gallery['texts'] !== undefined && !Array.isArray(gallery['texts'])) throw new AuthoringOperationError('PROJECT_INVALID', 'gallery.json.texts 必须是数组');
  let changed = false;
  for (const entry of (gallery['texts'] ?? []) as unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new AuthoringOperationError('PROJECT_INVALID', '文本回想条目必须是对象');
    const item = entry as Record<string, unknown>;
    if (item['scene'] !== sceneId || item['label'] !== oldName) continue;
    if (newName === undefined) {
      const reference = { path: GALLERY_PATH, kind: 'gallery-text', target: `${sceneId}.${oldName}` };
      if (references) { references.push(reference); continue; }
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '标签仍有引用，不能删除', { references: [reference] });
    }
    item['label'] = newName; changed = true;
  }
  return changed ? serializeProjectConfigDocument(gallery, source) : source;
}

export function isValidLabelName(name: unknown): name is string {
  return typeof name === 'string' && /^[^\s@"'\\]+$/.test(name);
}

export function applyConfigReferenceRename(files: Record<string, string>, rename: ProjectReferenceRename, fallbackEntry: string): void {
  if (rename.labelScene === undefined) renameConfigReferences(files, rename.from, rename.to, fallbackEntry);
  else {
    if (files[GALLERY_PATH] !== undefined) files[GALLERY_PATH] = renameGalleryLabel(files[GALLERY_PATH]!, rename.labelScene, rename.from, rename.to);
    const config = parseProjectConfigDocument(files['game.config.json'] ?? '{}');
    if (renameTextCatalogReferences(config, rename.from, rename.to, rename.labelScene)) files['game.config.json'] = serializeProjectConfigDocument(config, files['game.config.json'] ?? '{}');
  }
}

/** Identity rebasing for current source and existing Editor undo/redo snapshots. */
export function renameLabelDefinition(source: string, oldName: string, newName: string): string {
  const lines = parseSceneDocument(source);
  const labels = lines.filter(line => line.kind === 'label' && line.name === oldName);
  if (labels.length === 0) return source;
  if (labels.length > 1 || lines.some(line => line.kind === 'label' && line.name === newName)) throw new AuthoringOperationError('INVALID_REQUEST', '标签改名与既有标签冲突');
  const label = labels[0]!;
  label.raw = label.raw.replace(/^(\s*@label\s+)[^\s@]+/, (_match, prefix: string) => prefix + newName);
  return serializeSceneDocument(lines, defaultEol(lines));
}

/** Shared pure label edit; permissions/fingerprints remain the caller's boundary. */
export function editProjectLabel(files: Record<string, string>, sceneId: string, oldName: string, newName?: string): {
  path: string; line: number; affectedScenes: string[]; workingFiles: Record<string, string>;
} {
  const path = resolveUniqueScenarioPath(files, sceneId) ?? scenePath(sceneId);
  const source = files[path];
  if (source === undefined) throw new AuthoringOperationError('PROJECT_NOT_FOUND', `场景不存在：${sceneId}`);
  const lines = parseSceneDocument(source);
  const labelIndex = lines.findIndex(line => line.kind === 'label' && line.name === oldName);
  if (labelIndex < 0) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '标签已不存在，请重新读取场景');
  if (newName !== undefined && (!isValidLabelName(newName) || newName === oldName
    || lines.some(line => line.kind === 'label' && line.name === newName))) throw new AuthoringOperationError('INVALID_REQUEST', '新标签名不能重复、为空或包含空白、引号、反斜杠或 @');
  const workingFiles = { ...files }, references: Array<{ path: string; line?: number; kind: string; target: string }> = [];
  const affectedScenes = new Set<string>([sceneId]);
  for (const [filePath, text] of Object.entries(files)) {
    if (!/^content\/scenario\/.+\.gal$/i.test(filePath)) continue;
    const id = sceneIdFromScenarioPath(filePath);
    const rewritten = rewriteLabelReferences(text, filePath, id, sceneId, oldName, newName, references);
    if (rewritten !== text) { workingFiles[filePath] = rewritten; affectedScenes.add(id); }
  }
  const gallery = workingFiles[GALLERY_PATH];
  const config = parseProjectConfigDocument(workingFiles['game.config.json'] ?? '{}');
  if (newName === undefined) assertTextCatalogTargetRemovable(config, sceneId, oldName);
  else if (renameTextCatalogReferences(config, oldName, newName, sceneId)) workingFiles['game.config.json'] = serializeProjectConfigDocument(config, workingFiles['game.config.json'] ?? '{}');
  if (gallery !== undefined) workingFiles[GALLERY_PATH] = renameGalleryLabel(gallery, sceneId, oldName, newName, references);
  if (newName === undefined && references.length) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '标签仍有引用，不能删除', { references });
  if (newName === undefined) {
    const updated = parseSceneDocument(workingFiles[path]!); updated.splice(labelIndex, 1);
    workingFiles[path] = serializeSceneDocument(updated, defaultEol(updated));
  } else workingFiles[path] = renameLabelDefinition(workingFiles[path]!, oldName, newName);
  for (const id of affectedScenes) {
    const changedPath = resolveUniqueScenarioPath(workingFiles, id)!;
    validateSceneCandidate(changedPath, id, workingFiles[changedPath]!);
  }
  return { path, line: labelIndex + 1, affectedScenes: [...affectedScenes].sort(), workingFiles };
}

/** Validate a saved/recovered group against its real disk callers, not only the label definition. */
export function validateLabelRenameBatch(baseScenes: Record<string, string>, writes: Record<string, string>, renames: readonly ProjectReferenceRename[]): void {
  const invalid = (message: string): never => { throw new AuthoringOperationError('INVALID_REQUEST', message); };
  let expected = { ...baseScenes };
  const affected = new Set<string>();
  for (const rename of renames) {
    if (rename.labelScene === undefined) invalid('请分别保存标签改名和场景身份变更');
    const result = editProjectLabel(expected, rename.labelScene!, rename.from, rename.to);
    for (const path of Object.keys(expected)) if (result.workingFiles[path] !== expected[path]) affected.add(path);
    expected = result.workingFiles;
  }
  for (const path of affected) if (writes[path] === undefined) invalid(`标签改名缺少关联场景：${path}`);
  const finals = renames.map((rename, index) => {
    let name = rename.to;
    for (const later of renames.slice(index + 1)) if (later.labelScene === rename.labelScene && later.from === name) name = later.to;
    const path = resolveUniqueScenarioPath(writes, rename.labelScene!);
    if (!path || !parseSceneDocument(writes[path]!).some(line => line.kind === 'label' && line.name === name)) invalid('标签改名的目标定义必须在同批保存中');
    return { scene: rename.labelScene, name };
  });
  const submitted = { ...baseScenes, ...writes };
  for (const rename of renames) {
    if (finals.some(label => label.scene === rename.labelScene && label.name === rename.from)) continue;
    const references: Array<{ path: string; line?: number; kind: string; target: string }> = [];
    for (const [path, text] of Object.entries(submitted)) {
      const id = sceneIdFromScenarioPath(path);
      rewriteLabelReferences(text, path, id, rename.labelScene!, rename.from, undefined, references);
      if (id === rename.labelScene && parseSceneDocument(text).some(line => line.kind === 'label' && line.name === rename.from)) invalid('旧标签定义仍存在');
    }
    if (references.length) invalid('标签改名仍有未更新的引用');
  }
}

export async function applyScenePatch(change: ChangeSession, input: ScenePatchInput, hasher: TextHasher = compositionTextHasher): Promise<{ path: string; line: number; kind: string; affectedScenes?: string[] }> {
  const patch = input.patch;
  if ((patch.kind === 'renameLabel' || patch.kind === 'removeLabel')
    && (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined)) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '标签改名/删除只支持普通 direct 草稿，不进入候选或组合结果', { operationApplied: false, operationId: input.operationId });
  }
  const sceneId = input.sceneId ?? sceneIdFromTarget(operationTarget(patch));
  if (sceneId === undefined) throw new AuthoringOperationError('INVALID_REQUEST', 'scene.patch 缺少 sceneId');
  const defaultPath = scenePath(sceneId); // Existing scenes may live in subdirectories.
  return runOperation<{ path: string; line: number; kind: string; affectedScenes?: string[] }>(change, input, async (record) => {
    if (sceneIdFromTarget(operationTarget(patch)) !== sceneId) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'scene.patch 的目标或 anchor 必须属于所选场景');
    }
    if (patch.kind === 'replaceInstruction') {
      const target = /^scene:([^/]+)\/instruction:(\d+)@[0-9a-f]{8}-([0-9a-f]{8})$/.exec(patch.target);
      if (target?.[1] !== sceneId || target?.[3] !== patch.expectedFingerprint) {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'replaceInstruction 需要本场景的真实指令 objectRef 和原内容指纹');
      }
    }
    const path = resolveUniqueScenarioPath(record.workingFiles, sceneId) ?? defaultPath;
    const source = record.workingFiles[path];
    if (source === undefined) throw new AuthoringOperationError('PROJECT_NOT_FOUND', `场景不存在：${sceneId}`);
    const lines = parseSceneDocument(source);

    if (patch.kind === 'renameLabel' || patch.kind === 'removeLabel') {
      const oldName = patch.target.slice(`label:${sceneId}.`.length);
      const labelIndex = lines.findIndex((line) => line.kind === 'label' && line.name === oldName);
      if (!patch.target.startsWith(`label:${sceneId}.`) || labelIndex < 0) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '标签已不存在，请重新读取场景');
      checkPatchPrecondition(lines, patch, labelIndex);
      const { workingFiles, ...result } = editProjectLabel(record.workingFiles, sceneId, oldName, patch.kind === 'renameLabel' ? patch.name : undefined);
      return { result: { ...result, kind: patch.kind }, workingFiles };
    }

    if (patch.kind === 'replaceChoiceGroup' || patch.kind === 'replaceConditionBlock') {
      let structures: ReturnType<typeof parseSceneStructure>;
      try {
        structures = parseSceneStructure(source, path, sceneId);
      } catch (error) {
        throw new AuthoringOperationError('INVALID_REQUEST', error instanceof Error ? error.message : String(error));
      }
      let nextLines: SceneDocumentLine[];
      let startLine: number;
      if (patch.kind === 'replaceChoiceGroup') {
        const structure = choiceStructureForTarget(lines, structures, patch.target, sceneId, patch.expectedFingerprint);
        nextLines = replaceChoiceGroupLines(lines, structure, patch.choice, defaultEol(lines));
        startLine = structure.span.startLine;
      } else {
        const structure = conditionStructureForTarget(lines, structures, patch.target, sceneId, patch.expectedFingerprint);
        if (patch.condition.kind !== 'condition' || !Array.isArray(patch.condition.branches)) {
          throw new AuthoringOperationError('INVALID_REQUEST', 'condition 必须包含 branches 数组');
        }
        nextLines = replaceConditionBlockLines(lines, structure, patch.condition, defaultEol(lines), sceneId);
        startLine = structure.span.startLine;
      }
      const text = serializeSceneDocument(nextLines, defaultEol(nextLines));
      validateSceneCandidate(path, sceneId, text);
      return {
        result: { path, line: startLine, kind: patch.kind },
        compositionDraft: await buildSceneOperationCompositionDraft({
          capabilityId: 'scene.patch', sceneId, path, beforeText: source, afterText: text,
          ...sceneCompositionConfig(record.workingFiles), hasher,
        }),
        workingFiles: { ...record.workingFiles, [path]: text },
      };
    }

    const index = patchLineIndex(lines, patch);
    checkPatchPrecondition(lines, patch, index);
    const current = lines[index]!;
    let nextLines: SceneDocumentLine[];
    if (patch.kind === 'replaceText') {
      if (current.kind !== 'text') throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'replaceText 目标不是台词对象');
      const replacement = renderText(patch.speaker ?? current.speaker, patch.value, current.sep, lineIndent(current.raw), previousKind(lines, index));
      nextLines = [...lines];
      nextLines[index] = materializeInput(replacement, current.eol || defaultEol(lines));
      nextLines[index]!.eol = current.eol;
    } else if (patch.kind === 'patchStageProperties') {
      if (current.kind !== 'instr' && current.kind !== 'choice-option') throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '舞台来源不是指令或选择项');
      const raw = patchStageSourceLine(source, path, sceneId, index + 1, current.raw, patch.instructionIndex, patch.values);
      nextLines = [...lines]; nextLines[index] = { ...current, raw };
    } else if (patch.kind === 'replaceInstruction') {
      if (current.kind !== 'instr' || !REPLACEABLE_SCENE_INSTRUCTIONS.some((name) => name === current.name)) {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `replaceInstruction 目标必须是可替换的单条场景指令（${REPLACEABLE_SCENE_INSTRUCTIONS.join('、')}）`);
      }
      if (patch.instruction.kind !== 'instruction' || !REPLACEABLE_SCENE_INSTRUCTIONS.includes(patch.instruction.name)) {
        throw new AuthoringOperationError('INVALID_REQUEST', `replaceInstruction 仅支持可替换的单条场景指令（${REPLACEABLE_SCENE_INSTRUCTIONS.join('、')}）`);
      }
      const replacement = renderBlocks([patch.instruction])[0]!.raw;
      if (/[\r\n\u2028\u2029]/.test(replacement)) {
        throw new AuthoringOperationError('INVALID_REQUEST', 'replaceInstruction 不能包含换行或多条指令');
      }
      const raw = /^\s*/.exec(current.raw)![0] + replacement + /\s*$/.exec(current.raw)![0];
      nextLines = [...lines];
      nextLines[index] = parseSceneLine(raw, previousKind(lines, index), current.eol);
    } else if (patch.kind === 'insertBefore') {
      if (current.kind === 'instr' && current.name === 'scene') throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '不能在场景声明之前插入正文或指令');
      const nextContent = lines.slice(index).find(line => line.kind !== 'blank' && line.kind !== 'comment');
      const previous = previousKind(lines, index);
      if (nextContent?.kind === 'choice-option' && (previous === 'choice' || previous === 'choice-option')) {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '不能在选择组内部插入正文或指令；请用 replaceChoiceGroup 修改完整选择组');
      }
      nextLines = insertLinesAfter(lines, index - 1, renderBlocks(patch.blocks), defaultEol(lines));
    } else if (patch.kind === 'insertAfter') {
      const nextContent = lines.slice(index + 1).find(line => line.kind !== 'blank' && line.kind !== 'comment');
      if ((current.kind === 'choice-option' || previousKind(lines, index + 1) === 'choice-option')
        && nextContent?.kind === 'choice-option') {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '不能在选择组内部插入正文或指令；请用 replaceChoiceGroup 修改完整选择组');
      }
      nextLines = insertLinesAfter(lines, index, renderBlocks(patch.blocks), defaultEol(lines));
    } else if (patch.kind === 'replaceChoiceOption') {
      if (current.kind !== 'choice-option') throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'replaceChoiceOption 目标不是选择项');
      nextLines = [...lines];
      nextLines[index] = parseSceneLine(renderChoiceOption(patch.option, lineIndent(current.raw)), previousKind(lines, index), current.eol);
    } else {
      if (current.kind === 'instr' && current.name === 'scene') {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '不能移除场景声明');
      }
      nextLines = lines.filter((_, lineIndex) => lineIndex !== index);
    }
    const text = serializeSceneDocument(nextLines, defaultEol(nextLines));
    validateSceneCandidate(path, sceneId, text);
    return {
      result: { path, line: index + 1, kind: patch.kind },
      compositionDraft: await buildSceneOperationCompositionDraft({
        capabilityId: 'scene.patch', sceneId, path, beforeText: source, afterText: text,
        ...sceneCompositionConfig(record.workingFiles), hasher,
      }),
      workingFiles: { ...record.workingFiles, [path]: text },
    };
  });
}

export async function ensureVariable(change: ChangeSession, input: VariableEnsureInput, hasher: TextHasher = compositionTextHasher): Promise<{ name: string; created: boolean }> {
  return runOperation<{ name: string; created: boolean }>(change, input, async (record) => {
    const path = 'game.config.json';
    const currentText = record.workingFiles[path] ?? '{}';
    const config = parseProjectConfigDocument(currentText);
    const variablesValue = config['variables'];
    if (variablesValue !== undefined && (typeof variablesValue !== 'object' || variablesValue === null || Array.isArray(variablesValue))) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'game.config.json.variables 必须是对象');
    }
    const variables = { ...(variablesValue as Record<string, unknown> | undefined) };
    const declaration: Record<string, unknown> = { type: input.type, initial: input.initial };
    if (input.readonly !== undefined) declaration['readonly'] = input.readonly;
    if (input.min !== undefined) declaration['min'] = input.min;
    if (input.max !== undefined) declaration['max'] = input.max;
    const hasExisting = Object.prototype.hasOwnProperty.call(variables, input.name);
    const existing = hasExisting ? variables[input.name] : undefined;
    if (hasExisting) {
      if (stableStringify(existing) !== stableStringify(declaration)) {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `变量合同冲突：${input.name}`);
      }
      return {
        result: { name: input.name, created: false }, changed: false,
        compositionDraft: await buildVariableOperationCompositionDraft({ name: input.name, declaration, existing, hasher }),
      };
    }
    config['variables'] = { ...variables, [input.name]: declaration };
    return {
      result: { name: input.name, created: true },
      compositionDraft: await buildVariableOperationCompositionDraft({ name: input.name, declaration, hasher }),
      workingFiles: { ...record.workingFiles, [path]: serializeProjectConfigDocument(config, currentText) },
    };
  });
}
