import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';

export const RENDERER_STARTUP_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const rendererStartupSourceRelativePath = 'examples/shared/player/player.ts';

const scriptPath = url.fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../..');
const sourceMarker = '__surdetRendererStartupDiagnostic';
const requiredMarkers = [
  'starterModuleStartedAt',
  'runtimeCreateStartedAt',
  'runtimeCreateCompletedAt',
  'debugPublishedAt',
  'assetLoadStartedAt',
  'assetLoadCompletedAt',
  'titleReadyAt',
  'firstStableFrameAt',
];
const markerNames = [...requiredMarkers, 'fontsReadyAt'];
const derivedNames = [
  'navigationToDebugMs',
  'runtimeCreateMs',
  'assetLoadMs',
  'debugToAssetDoneMs',
  'assetDoneToStableFrameMs',
];
const sourceShaPattern = /^[0-9a-f]{40}$/i;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function git(workspaceRoot, args) {
  return execFileSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    shell: false,
  });
}

function countOccurrences(source, needle) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function replaceUnique(source, needle, replacement, label) {
  const count = countOccurrences(source, needle);
  if (count !== 1) throw new Error(`${label} 锚点必须唯一，实际为 ${count}`);
  return source.replace(needle, replacement);
}

function assertFiniteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必须是非负有限数：${String(value)}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} 必须是非空字符串`);
}

function assertUnavailableOrAvailableMarker(value, label) {
  if (!isRecord(value) || (value.available !== true && value.available !== false)) {
    throw new Error(`${label} 必须明确 available=true/false`);
  }
  if (value.available === true) assertFiniteNonNegative(value.monotonicMs, `${label}.monotonicMs`);
  else assertNonEmptyString(value.reason, `${label}.reason`);
}

function assertDuration(value, label) {
  if (value === null) return;
  assertFiniteNonNegative(value, label);
}

function startupPrelude() {
  return [
    '  const __surdetStartupMarkers: Record<string, { available: true; monotonicMs: number }> = {};',
    '  const __surdetMarkStartup = (name: string): void => {',
    '    __surdetStartupMarkers[name] = Object.freeze({ available: true, monotonicMs: performance.now() });',
    '  };',
    '  const __surdetStartupDiagnostic = {',
    `    schemaVersion: ${RENDERER_STARTUP_DIAGNOSTIC_SCHEMA_VERSION},`,
    '    getSnapshot: () => {',
    '      const navigation = performance.getEntriesByType(\'navigation\')[0] as PerformanceNavigationTiming | undefined;',
    '      const resources = performance.getEntriesByType(\'resource\').map((entry) => {',
    '        const resource = entry as PerformanceResourceTiming;',
    '        return {',
    '          name: resource.name,',
    '          initiatorType: resource.initiatorType,',
    '          durationMs: resource.duration,',
    '          transferSize: resource.transferSize,',
    '          encodedBodySize: resource.encodedBodySize,',
    '          decodedBodySize: resource.decodedBodySize,',
    '        };',
    '      });',
    '      const resourceByInitiatorType: Record<string, number> = {};',
    '      for (const resource of resources) resourceByInitiatorType[resource.initiatorType] = (resourceByInitiatorType[resource.initiatorType] ?? 0) + 1;',
    '      const markerValues = Object.values(__surdetStartupMarkers);',
    '      const markerAt = (index: number): number | null => markerValues[index]?.monotonicMs ?? null;',
    '      const durationBetween = (start: number, end: number): number | null => {',
    '        const startAt = markerAt(start);',
    '        const endAt = markerAt(end);',
    '        return startAt === null || endAt === null ? null : endAt - startAt;',
    '      };',
    '      return Object.freeze({',
    `        schemaVersion: ${RENDERER_STARTUP_DIAGNOSTIC_SCHEMA_VERSION},`,
    '        timeOriginMs: performance.timeOrigin,',
    '        navigationStartMs: navigation?.startTime ?? 0,',
    '        markers: Object.freeze({',
    '          ...__surdetStartupMarkers,',
    "          fontsReadyAt: Object.freeze({ available: false, reason: 'font loading is part of the asset queue' }),",
    '        }),',
    '        derived: Object.freeze({',
    '          navigationToDebugMs: markerAt(3) === null ? null : markerAt(3) - (navigation?.startTime ?? 0),',
    '          runtimeCreateMs: durationBetween(1, 2),',
    '          assetLoadMs: durationBetween(4, 5),',
    '          debugToAssetDoneMs: markerAt(3) === null || markerAt(5) === null ? null : markerAt(5)! - markerAt(3)!,',
    '          assetDoneToStableFrameMs: durationBetween(5, 7),',
    '        }),',
    '        resourceTiming: Object.freeze({',
    '          count: resources.length,',
    '          byInitiatorType: Object.freeze(resourceByInitiatorType),',
    '          totalTransferSize: resources.reduce((sum, resource) => sum + resource.transferSize, 0),',
    '          entries: Object.freeze(resources),',
    '        }),',
    '      });',
    '    },',
    '  };',
    `  (window as unknown as Record<string, unknown>).${sourceMarker} = __surdetStartupDiagnostic;`,
    "  __surdetMarkStartup('starterModuleStartedAt');",
  ].join('\n');
}

export function transformRendererStartupSource(source) {
  if (typeof source !== 'string') throw new Error('插桩源代码必须是字符串');
  if (source.includes(sourceMarker)) throw new Error('统一启动诊断探针已经存在，拒绝重复插桩');
  const normalized = source.replace(/\r\n/g, '\n');
  const mainAnchor = normalized.includes('export async function startPlayer(project: PlayerProject): Promise<void> {')
    ? 'export async function startPlayer(project: PlayerProject): Promise<void> {\n'
    : 'async function main(): Promise<void> {\n';
  let transformed = replaceUnique(normalized, mainAnchor, `${mainAnchor}${startupPrelude()}\n`, 'main');
  const modernRuntimeStart = '  const runtime = await createRendererRuntime({';
  if (countOccurrences(transformed, modernRuntimeStart) === 1) {
    transformed = replaceUnique(
      transformed,
      modernRuntimeStart,
      "  __surdetMarkStartup('runtimeCreateStartedAt');\n  const runtime = await createRendererRuntime({",
      'runtime create start',
    );
    transformed = replaceUnique(
      transformed,
      '  });\n  appEl.appendChild(runtime.canvas);',
      "  });\n  __surdetMarkStartup('runtimeCreateCompletedAt');\n  appEl.appendChild(runtime.canvas);",
      'runtime create completion',
    );
  } else {
    const legacyStageConstructor = ['Pixi', 'Stage'].join('');
    transformed = replaceUnique(
      transformed,
      `  const stage = new ${legacyStageConstructor}();\n`,
      `  __surdetMarkStartup('runtimeCreateStartedAt');\n  const stage = new ${legacyStageConstructor}();\n`,
      'legacy runtime create start',
    );
    transformed = replaceUnique(
      transformed,
      '  await stage.init();\n',
      "  await stage.init();\n  __surdetMarkStartup('runtimeCreateCompletedAt');\n",
      'legacy runtime create completion',
    );
  }
  transformed = replaceUnique(
    transformed,
    '  };\n\n  // ===== 存档富化：缩略图（舞台截图）+ 本次会话游戏时长 =====',
    "  };\n  __surdetMarkStartup('debugPublishedAt');\n\n  // ===== 存档富化：缩略图（舞台截图）+ 本次会话游戏时长 =====",
    'debug publish',
  );
  transformed = replaceUnique(
    transformed,
    '  async function loadAssets(): Promise<void> {',
    "  async function loadAssets(): Promise<void> {\n    __surdetMarkStartup('assetLoadStartedAt');",
    'asset load start',
  );
  transformed = replaceUnique(
    transformed,
    '    lastLoadingProgress = { ...finalProgress };',
    "    lastLoadingProgress = { ...finalProgress };\n    __surdetMarkStartup('assetLoadCompletedAt');",
    'asset load completion',
  );
  transformed = replaceUnique(
    transformed,
    '  showTitleScreen();\n  console.info(`[starter] started:',
    "  showTitleScreen();\n  __surdetMarkStartup('titleReadyAt');\n  requestAnimationFrame(() => __surdetMarkStartup('firstStableFrameAt'));\n  console.info(`[starter] started:",
    'title/stable frame',
  );
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  return transformed.replace(/\n/g, lineEnding);
}

export function parseRendererStartupDiagnosticArgs(argv, baseDirectory = process.cwd()) {
  let root;
  let outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--root' && argument !== '--out') throw new Error(`未知参数：${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${argument}`);
    if (argument === '--root') {
      if (root !== undefined) throw new Error('--root 只能出现一次');
      root = path.resolve(baseDirectory, value);
    } else {
      if (outputPath !== undefined) throw new Error('--out 只能出现一次');
      outputPath = path.resolve(baseDirectory, value);
    }
    index += 1;
  }
  if (root === undefined) throw new Error('缺少必需参数：--root <workspace>');
  if (outputPath === undefined) throw new Error('缺少必需参数：--out <file>');
  return { root, outputPath };
}

export function validateRendererStartupDiagnosticSnapshot(value) {
  if (!isRecord(value) || value.schemaVersion !== RENDERER_STARTUP_DIAGNOSTIC_SCHEMA_VERSION) {
    throw new Error(`启动诊断 schemaVersion 必须为 ${RENDERER_STARTUP_DIAGNOSTIC_SCHEMA_VERSION}`);
  }
  assertFiniteNonNegative(value.timeOriginMs, 'timeOriginMs');
  assertFiniteNonNegative(value.navigationStartMs, 'navigationStartMs');
  if (!isRecord(value.markers)) throw new Error('markers 必须是对象');
  for (const marker of requiredMarkers) assertUnavailableOrAvailableMarker(value.markers[marker], `markers.${marker}`);
  assertUnavailableOrAvailableMarker(value.markers.fontsReadyAt, 'markers.fontsReadyAt');
  if (!isRecord(value.derived)) throw new Error('derived 必须是对象');
  for (const name of derivedNames) assertDuration(value.derived[name], `derived.${name}`);
  if (!isRecord(value.resourceTiming)) throw new Error('resourceTiming 必须是对象');
  if (!Number.isInteger(value.resourceTiming.count) || value.resourceTiming.count < 0) {
    throw new Error('resourceTiming.count 必须是非负整数');
  }
  if (!isRecord(value.resourceTiming.byInitiatorType)) throw new Error('resourceTiming.byInitiatorType 必须是对象');
  assertFiniteNonNegative(value.resourceTiming.totalTransferSize, 'resourceTiming.totalTransferSize');
  if (!Array.isArray(value.resourceTiming.entries)) throw new Error('resourceTiming.entries 必须是数组');
  for (const [index, entry] of value.resourceTiming.entries.entries()) {
    if (!isRecord(entry)) throw new Error(`resourceTiming.entries[${index}] 必须是对象`);
    assertNonEmptyString(entry.name, `resourceTiming.entries[${index}].name`);
    assertNonEmptyString(entry.initiatorType, `resourceTiming.entries[${index}].initiatorType`);
    assertFiniteNonNegative(entry.durationMs, `resourceTiming.entries[${index}].durationMs`);
    assertFiniteNonNegative(entry.transferSize, `resourceTiming.entries[${index}].transferSize`);
    assertFiniteNonNegative(entry.encodedBodySize, `resourceTiming.entries[${index}].encodedBodySize`);
    assertFiniteNonNegative(entry.decodedBodySize, `resourceTiming.entries[${index}].decodedBodySize`);
  }
  if (value.resourceTiming.entries.length !== value.resourceTiming.count) {
    throw new Error('resourceTiming.count 必须等于 entries.length');
  }
  return value;
}

export function applyRendererStartupInstrumentation(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  // The diagnostic explicitly supports its frozen pre-extraction comparison commit.
  const relativeSource = fs.existsSync(path.join(root, rendererStartupSourceRelativePath))
    ? rendererStartupSourceRelativePath : 'examples/starter/src/main.ts';
  const sourcePath = path.join(root, relativeSource);
  if (!fs.existsSync(sourcePath)) throw new Error(`插桩源文件不存在：${sourcePath}`);
  const beforeStatus = git(root, ['status', '--porcelain', '--untracked-files=all']).trim();
  if (beforeStatus !== '') throw new Error(`插桩要求干净 checkout，当前状态为：\n${beforeStatus}`);
  const originalCommit = git(root, ['rev-parse', 'HEAD']).trim();
  if (!sourceShaPattern.test(originalCommit)) throw new Error(`工作树 HEAD 不是完整 SHA：${originalCommit}`);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transformed = transformRendererStartupSource(source);
  fs.writeFileSync(sourcePath, transformed, 'utf8');
  git(root, ['diff', '--check']);
  const sourceDiff = git(root, ['diff', '--binary', '--', relativeSource]);
  const fullDiff = git(root, ['diff', '--binary']);
  const changedPaths = git(root, ['diff', '--name-only']).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const afterStatus = git(root, ['status', '--porcelain', '--untracked-files=all']).split(/\r?\n/).map((item) => item.trimEnd()).filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== relativeSource) {
    throw new Error(`启动诊断插桩产生了额外 tracked 差异：${JSON.stringify(changedPaths)}`);
  }
  if (fullDiff !== sourceDiff) throw new Error('启动诊断完整 diff 与唯一 source diff 不一致');
  if (afterStatus.length !== 1 || !afterStatus[0].endsWith(relativeSource)) {
    throw new Error(`启动诊断插桩后工作树不精确：${JSON.stringify(afterStatus)}`);
  }
  return {
    originalCommit,
    instrumentationScriptPath: path.relative(repositoryRoot, scriptPath).replace(/\\/g, '/'),
    instrumentationScriptSha256: sha256File(scriptPath),
    instrumentedPaths: changedPaths,
    appliedDiffCheck: true,
    instrumentationDiffSha256: sha256Bytes(Buffer.from(sourceDiff, 'utf8')),
    fullDiffSha256: sha256Bytes(Buffer.from(fullDiff, 'utf8')),
    onlyUnifiedInstrumentationDiff: true,
    beforeStatus,
    afterStatus,
    lockfileSha256: sha256File(path.join(root, 'package-lock.json')),
    node: process.version,
    platform: os.platform(),
    arch: process.arch,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  try {
    const parsed = parseRendererStartupDiagnosticArgs(process.argv.slice(2));
    const result = applyRendererStartupInstrumentation(parsed.root);
    fs.mkdirSync(path.dirname(parsed.outputPath), { recursive: true });
    fs.writeFileSync(parsed.outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
