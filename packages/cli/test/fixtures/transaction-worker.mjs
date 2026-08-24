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

async function appendEvent(file, event) {
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
}

async function main() {
  const cliDist = requiredString('cliDist');
  const authoringDist = requiredString('authoringDist');
  const changeId = requiredString('changeId');
  const operationId = requiredString('operationId');
  const mode = args.mode ?? 'low-level';
  const relativePath = requiredString('relativePath');
  const marker = requiredString('marker');
  const readyFile = requiredString('readyFile');
  const releaseFile = requiredString('releaseFile');
  const resultFile = requiredString('resultFile');
  const { NodeChangeStore } = await import(pathToFileURL(path.join(cliDist, 'authoring', 'node-change-store.js')).href);
  if (typeof args.replaceEventsFile === 'string') {
    const { NodeProjectStorage } = await import(pathToFileURL(path.join(cliDist, 'authoring', 'node-project-storage.js')).href);
    const originalReplaceFromStage = NodeProjectStorage.prototype.replaceFromStage;
    NodeProjectStorage.prototype.replaceFromStage = async function(relativePath, stagedIdentity) {
      await appendEvent(args.replaceEventsFile, { event: 'replace-start', operationId, relativePath });
      await delay(typeof args.replaceDelayMs === 'number' ? args.replaceDelayMs : 50);
      try {
        return await originalReplaceFromStage.call(this, relativePath, stagedIdentity);
      } finally {
        await appendEvent(args.replaceEventsFile, { event: 'replace-end', operationId, relativePath });
      }
    };
  }

  const opened = await NodeChangeStore.openByChangeId(changeId);
  if (opened === null) throw new Error(`missing change ${changeId}`);
  let serviceSession;
  let directService;
  if (mode === 'service-mutation' || mode === 'service-commit') {
    const projectRoot = requiredString('projectRoot');
    const { openAgentPortSession } = await import(pathToFileURL(path.join(cliDist, 'agent-port', 'session.js')).href);
    serviceSession = await openAgentPortSession({ projectRoot, policy: mode === 'service-commit' ? 'apply' : 'stage', resumeChangeId: changeId });
    if (mode === 'service-commit') {
      const mutation = await serviceSession.invoke('scene.create', {
        operationId,
        sceneId: marker,
        blocks: [],
      });
      if (!mutation.ok) throw new Error(`mutation failed: ${mutation.error.code}: ${mutation.error.message}`);
      for (const [capability, input] of [
        ['project.validate', {}],
        ['project.simulate', {}],
        ['runtime.run-from', { sceneId: 'start', choices: [] }],
        ['change.diff', {}],
      ]) {
        const evidence = await serviceSession.invoke(capability, input);
        if (!evidence.ok) throw new Error(`evidence failed: ${evidence.error.code}: ${evidence.error.message}`);
      }
      const { AuthoringService } = await import(pathToFileURL(path.join(cliDist, 'authoring', 'authoring-service.js')).href);
      directService = new AuthoringService();
    }
  }
  await fs.writeFile(readyFile, `${opened.record.workingRevision}\n`, { flag: 'wx' });
  while (!(await exists(releaseFile))) await delay(10);
  try {
    if (mode === 'service-mutation') {
      const envelope = await serviceSession.invoke('scene.create', {
        operationId,
        sceneId: marker,
        blocks: [],
      });
      await serviceSession.close();
      await fs.writeFile(resultFile, JSON.stringify({
        ok: envelope.ok,
        ...(envelope.ok ? { result: envelope.result } : { code: envelope.error.code, message: envelope.error.message }),
      }), { flag: 'wx' });
    } else if (mode === 'service-commit') {
      await serviceSession.close();
      let envelope;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          envelope = { ok: true, result: await directService.commit(changeId) };
          break;
        } catch (error) {
          envelope = {
            ok: false,
            code: error?.code ?? error?.name ?? 'UNKNOWN',
            message: String(error?.message ?? error),
            details: error?.details,
          };
          if (envelope.code !== 'PROJECT_BUSY' || attempt === 39) break;
        }
        await delay(10);
      }
      await fs.writeFile(resultFile, JSON.stringify({
        ok: envelope.ok,
        ...(envelope.ok ? { result: envelope.result } : { code: envelope.code, message: envelope.message, details: envelope.details }),
      }), { flag: 'wx' });
    } else {
      const { openChange, runOperation } = await import(pathToFileURL(path.join(authoringDist, 'change-session.js')).href);
      let result;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          result = await NodeChangeStore.withChangeLease(changeId, async (leasedStore) => {
            const change = openChange(opened.record, leasedStore);
            return runOperation(change, { operationId }, (record) => ({
              result: { marker },
              workingFiles: { ...record.workingFiles, [relativePath]: marker },
            }));
          });
          break;
        } catch (error) {
          const transientMissingLease = error?.code === 'LEASE_CORRUPT' && String(error?.message ?? '').includes('lease.json 缺失');
          if ((error?.code !== 'CHANGE_BUSY' && !transientMissingLease) || attempt === 39) throw error;
          await delay(5);
        }
      }
      await fs.writeFile(resultFile, JSON.stringify({ ok: true, result }), { flag: 'wx' });
    }
  } catch (error) {
    await serviceSession?.close().catch(() => undefined);
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
