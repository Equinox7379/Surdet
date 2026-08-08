import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FileSaveStore, MAX_SAVE_BYTES } from '../dist/save-store.js';

const MiB = 1024 * 1024;
const ROUNDS = 20;
const TARGETS = [1, 5, 9];

function makeSnapshot(targetBytes, slot) {
  const snapshot = {
    meta: { id: slot, createdAt: 1, updatedAt: 1 },
    variables: { payload: '' },
    position: { sceneId: 'benchmark', pc: 0 },
    kind: 'manual',
    readSet: ['benchmark#0'],
    gallery: { cgs: [], music: [] },
  };
  const overhead = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  snapshot.variables.payload = 'x'.repeat(Math.max(0, targetBytes - overhead - 128));
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  if (bytes > MAX_SAVE_BYTES) throw new Error(`benchmark fixture exceeds MAX_SAVE_BYTES: ${bytes}`);
  return { snapshot, bytes };
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function measure(operation, run) {
  const samples = [];
  for (let i = 0; i < ROUNDS; i++) {
    const start = performance.now();
    run(i);
    samples.push(performance.now() - start);
  }
  return {
    operation,
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
  };
}

let benchDir;
try {
  benchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-save-bench-'));
  const store = new FileSaveStore(benchDir);
  const results = [];
  for (const sizeMiB of TARGETS) {
    const slots = Array.from({ length: ROUNDS }, (_, i) => `bench-${sizeMiB}-${i}`);
    const { snapshot, bytes } = makeSnapshot(sizeMiB * MiB, slots[0]);
    const write = measure('write', (i) => store.write(slots[i], { ...snapshot, meta: { ...snapshot.meta, id: slots[i] } }));
    const read = measure('read', (i) => store.read(slots[i]));
    const listMeta = measure('listMeta', () => store.listMeta());
    for (const result of [write, read, listMeta]) {
      results.push({ sizeMiB, bytes, ...result });
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (benchDir) fs.rmSync(benchDir, { recursive: true, force: true });
}
