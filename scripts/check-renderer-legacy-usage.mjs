import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGACY_RENDERER_SYMBOLS = ['PixiStage', 'AdvRenderer', 'AdvStage'];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const ALLOWED_PATHS = [
  'packages/renderer/src/legacy',
  'packages/renderer/src/pixi-stage.ts',
  'packages/renderer/src/adv-renderer.ts',
  'packages/renderer/src/types.ts',
  'packages/renderer/src/index.ts',
  'packages/renderer/test/legacy',
];
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'release']);

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isAllowed(relativePath) {
  return ALLOWED_PATHS.some((allowed) => relativePath === allowed || relativePath.startsWith(`${allowed}/`));
}

function collectSourceFiles(root, directory = root, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(root, absolute, result);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(absolute);
  }
  return result;
}

function hasImportReference(source, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linePattern = new RegExp(`\\b(?:import|export)\\b[^\\n;]*\\b${escaped}\\b`);
  if (source.split(/\r?\n/).some((line) => linePattern.test(line))) return true;
  const declarationPattern = new RegExp(`\\b(?:import|export)\\b[\\s\\S]{0,400}\\b${escaped}\\b[\\s\\S]{0,100}\\bfrom\\b`);
  return declarationPattern.test(source);
}

function hasDirectReference(source, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:new|extends|implements|as|:)\\s*${escaped}\\b`).test(source)
    || new RegExp(`\\b${escaped}\\s*\\(`).test(source);
}

function legacyModuleReferences(source) {
  const references = [];
  const pattern = /\b(?:from\s+|import\s*)['"]([^'"]*\/legacy\/[^'"]*)['"]/g;
  for (const match of source.matchAll(pattern)) {
    references.push(match[1].replace(/\.js$/, ''));
  }
  return [...new Set(references)].sort((left, right) => left.localeCompare(right));
}

export function checkLegacyUsage(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const failures = [];
  const sourceFiles = [];
  for (const sourceRoot of ['packages', 'examples', 'games']) {
    collectSourceFiles(root, path.join(root, sourceRoot), sourceFiles);
  }
  for (const absolute of sourceFiles.sort()) {
    const relative = normalizeRelative(path.relative(root, absolute));
    if (isAllowed(relative)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const modulePath of legacyModuleReferences(source)) {
      failures.push(`${relative} imports legacy module ${modulePath}`);
    }
    for (const symbol of LEGACY_RENDERER_SYMBOLS) {
      if (hasImportReference(source, symbol)) {
        failures.push(`${relative} imports legacy renderer symbol ${symbol}`);
      } else if (hasDirectReference(source, symbol)) {
        failures.push(`${relative} uses legacy renderer symbol ${symbol}`);
      }
    }
  }
  return failures.sort((left, right) => left.localeCompare(right));
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const repositoryRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(scriptPath), '..');
  const failures = checkLegacyUsage(repositoryRoot);
  if (failures.length > 0) {
    console.error('Renderer legacy API consumers detected:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('Renderer legacy API usage check passed.');
  }
}
