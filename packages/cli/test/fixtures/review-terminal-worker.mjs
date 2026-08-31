import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const parsed = JSON.parse(input);
  if (!isRecord(parsed)) throw new Error('worker command must be an object');
  return parsed;
}

function requiredString(command, key) {
  const value = command[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing ${key}`);
  return value;
}

async function waitForPeer(directory) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${process.pid}.ready`), 'ready\n', { flag: 'wx' })
    .catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = (await fs.readdir(directory)).filter((name) => name.endsWith('.ready'));
    if (ready.length >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for peer worker');
}

async function main() {
  const command = await readStdin();
  const dataRoot = path.resolve(requiredString(command, 'dataRoot'));
  const projectIdentity = requiredString(command, 'projectIdentity');
  const reviewId = requiredString(command, 'reviewId');
  const action = requiredString(command, 'action');
  await waitForPeer(path.join(dataRoot, '.review-terminal-worker', reviewId));

  try {
    if (action === 'authority') {
      if (!isRecord(command.terminalCommand)) throw new Error('missing terminalCommand');
      const { ReviewTerminalAuthority } = await import(new URL('../../dist/authoring/review-terminal-authority.js', import.meta.url));
      const authority = new ReviewTerminalAuthority(dataRoot);
      const snapshot = await authority.write(command.terminalCommand);
      if (!isRecord(snapshot.record)) throw new Error('authority response is missing canonical record');
      process.stdout.write(JSON.stringify({
        status: 'written',
        boundary: 'ReviewTerminalAuthority',
        snapshot,
        identity: { bytes: snapshot.record.bytes, sha256: snapshot.record.sha256 },
      }));
      return;
    }
    if (!isRecord(command.receipt)) throw new Error('missing receipt');
    const { NodeReviewStore } = await import(new URL('../../dist/authoring/node-review-store.js', import.meta.url));
    const store = new NodeReviewStore(path.join(dataRoot, projectIdentity), projectIdentity);
    const identity = action === 'decision'
      ? await store.createDecision(reviewId, command.receipt)
      : action === 'approval'
        ? await store.createFinalApproval(reviewId, command.receipt)
        : action === 'return'
          ? await store.createReturnRequest(reviewId, command.receipt)
          : (() => { throw new Error(`unsupported action: ${action}`); })();
    process.stdout.write(JSON.stringify({ status: 'written', identity }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'rejected',
      code: typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'WORKER_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    status: 'rejected',
    code: 'HARNESS_INVALID',
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
