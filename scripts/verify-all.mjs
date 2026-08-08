import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmPrefix = process.platform === 'win32'
  ? [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  : [];
const nodeCommand = process.execPath;
const npmArgs = (...args) => [...npmPrefix, ...args];

export const verificationSteps = [
  { id: 'tools', command: npmCommand, args: npmArgs('run', 'verify:tools') },
  { id: 'docs', command: npmCommand, args: npmArgs('run', 'verify:docs') },
  { id: 'hygiene', command: npmCommand, args: npmArgs('run', 'verify:hygiene') },
  { id: 'types', command: npmCommand, args: npmArgs('run', 'typecheck') },
  { id: 'tests', command: npmCommand, args: npmArgs('test') },
  { id: 'starter-lint', command: npmCommand, args: npmArgs('run', 'lint', '-w', 'surdet-starter') },
  { id: 'starter-simulate', command: nodeCommand, args: ['packages/cli/dist/index.js', 'simulate', 'examples/starter', '--assume', 'battleWon=true'] },
  { id: 'formal', command: npmCommand, args: npmArgs('run', 'verify:formal') },
  { id: 'editor-build', command: npmCommand, args: npmArgs('run', 'build', '-w', 'surdet-editor') },
  { id: 'starter-build', command: npmCommand, args: npmArgs('run', 'build', '-w', 'surdet-starter') },
  { id: 'formal-build', command: npmCommand, args: npmArgs('run', 'build', '-w', 'zero-after-midnight') },
  { id: 'diff-check', command: 'git', args: ['diff', '--check'] },
];

export function runVerification(steps = verificationSteps, spawn = spawnSync) {
  for (const step of steps) {
    console.log(`[verify:${step.id}] ${step.command} ${step.args.join(' ')}`);
    const result = spawn(step.command, step.args, { cwd: root, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runVerification();
}
