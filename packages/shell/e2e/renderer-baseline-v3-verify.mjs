import fs from 'node:fs';
import path from 'node:path';
import * as url from 'node:url';
import { validateRendererBaselineV3Artifact } from './renderer-baseline-v3-artifact.mjs';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '../../..');
const candidatePath = path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-candidate-2026-08-09.json');
const v3ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline-v3.js');
const v2ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline.js');
const v3 = await import(url.pathToFileURL(v3ModulePath).href);
const v2 = await import(url.pathToFileURL(v2ModulePath).href);
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
validateRendererBaselineV3Artifact(candidate, { repositoryRoot, v3, v2 });
console.log(`Renderer v3 artifact PASS: ${candidatePath}`);
console.log(`formalFailures=${candidate.comparison.failures.map((item) => item.metric).join(',') || 'none'}`);
console.log(`historicalFailures=${candidate.historicalComparison.failures.map((item) => item.metric).join(',') || 'none'}`);
