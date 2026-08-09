import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const LAYER_SOURCE_RELATIVE = path.join('packages', 'renderer', 'src', 'layers');

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function isUnder(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function listTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(fullPath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function importSpecifiers(source) {
  const result = [];
  const staticImport = /\b(?:import|export)\s+(?:(?:type\s+)?[\s\S]*?\sfrom\s+)?(['"])([^'"]+)\1/g;
  const dynamicImport = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

  for (const match of source.matchAll(staticImport)) result.push(match[2]);
  for (const match of source.matchAll(dynamicImport)) result.push(match[2]);
  return result;
}

function hasPathSegment(value, segment) {
  return toPosix(value).split('/').includes(segment);
}

function boundaryFailuresForFile(root, layersRoot, filePath) {
  const sourceRelative = toPosix(path.relative(root, filePath));
  const sourceLayerRelative = path.relative(layersRoot, filePath);
  const sourceLayer = sourceLayerRelative.split(path.sep)[0];
  const source = fs.readFileSync(filePath, 'utf8');
  const failures = [];

  for (const specifier of importSpecifiers(source)) {
    const normalizedSpecifier = toPosix(specifier);
    const targetPath = specifier.startsWith('.')
      ? path.resolve(path.dirname(filePath), specifier)
      : null;

    if (hasPathSegment(normalizedSpecifier, 'legacy')
      || (targetPath !== null && hasPathSegment(path.relative(root, targetPath), 'legacy'))) {
      failures.push(`${sourceRelative} imports legacy renderer code: ${specifier}`);
      continue;
    }

    const importsGameCode = hasPathSegment(normalizedSpecifier, 'examples')
      || hasPathSegment(normalizedSpecifier, 'games')
      || (targetPath !== null && (isUnder(path.join(root, 'examples'), targetPath)
        || isUnder(path.join(root, 'games'), targetPath)));
    if (importsGameCode) {
      failures.push(`${sourceRelative} imports example/game code: ${specifier}`);
      continue;
    }

    if (targetPath === null || !isUnder(layersRoot, targetPath)) continue;
    const targetLayer = path.relative(layersRoot, targetPath).split(path.sep)[0];
    if (targetLayer && targetLayer !== sourceLayer) {
      failures.push(`${sourceRelative} imports another Layer: ${specifier}`);
    }
  }

  return failures;
}

export function checkRendererBoundaries(root) {
  const repositoryRoot = path.resolve(root);
  const layersRoot = path.join(repositoryRoot, LAYER_SOURCE_RELATIVE);
  const failures = listTypeScriptFiles(layersRoot)
    .flatMap((filePath) => boundaryFailuresForFile(repositoryRoot, layersRoot, filePath));
  return [...new Set(failures)].sort((left, right) => left.localeCompare(right));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const root = process.cwd();
  const failures = checkRendererBoundaries(root);
  if (failures.length > 0) {
    console.error('Renderer Layer boundary check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('Renderer Layer boundary check passed.');
  }
}
