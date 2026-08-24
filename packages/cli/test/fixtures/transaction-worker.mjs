import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = JSON.parse(process.argv[2] ?? '{}');

function requiredString(name) {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing worker argument: ${name}`);
  return value;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const cliDist = requiredString('cliDist');
  const authoringDist = requiredString('authoringDist');
  const changeId = requiredString('changeId');
  const operationId = requiredString('operationId');
  const relativePath = requiredString('relativePath');
  const marker = requiredString('marker');
  const readyFile = requiredString('readyFile');
  const releaseFile = requiredString('releaseFile');
  const resultFile = requiredString('resultFile');
  const { NodeChangeStore } = await import(pathToFileURL(path.join(cliDist, 'authoring', 'node-change-store.js')).href);
  const { openChange, runOperation } = await import(pathToFileURL(path.join(authoringDist, 'change-session.js')).href);

  const opened = await NodeChangeStore.openByChangeId(changeId);
  if (opened === null) throw new Error(`missing change ${changeId}`);
  const change = openChange(opened.record, opened.store);
  await fs.writeFile(readyFile, `${opened.record.workingRevision}\n`, { flag: 'wx' });
  while (!(await exists(releaseFile))) await delay(10);
  try {
    const result = await runOperation(change, { operationId }, (record) => ({
      result: { marker },
      workingFiles: { ...record.workingFiles, [relativePath]: marker },
    }));
    await fs.writeFile(resultFile, JSON.stringify({ ok: true, result }), { flag: 'wx' });
  } catch (error) {
    await fs.writeFile(resultFile, JSON.stringify({
      ok: false,
      code: error?.code ?? error?.name ?? 'UNKNOWN',
      message: String(error?.message ?? error),
    }), { flag: 'wx' });
  }
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
