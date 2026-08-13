import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BGM_ALLOWLIST = Object.freeze([
  'blackout.wav',
  'convenience_hum.wav',
  'ending_meeting.wav',
  'ending_silence.wav',
  'ending_testimony.wav',
  'investigation.wav',
  'last_train.wav',
  'midnight_rain.wav',
  'old_room.wav',
  'underground_signal.wav',
]);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_ASSET_DIR = join(GAME_ROOT, 'content', 'assets', 'bgm');

function wavError(message) {
  return new Error(`WAV ${message}`);
}

function dbfs(value) {
  return 20 * Math.log10(value || Number.MIN_VALUE);
}

function readChunkId(buffer, offset) {
  return buffer.toString('ascii', offset, offset + 4);
}

/** Parse and measure a RIFF/WAVE PCM signed 16-bit file. */
export function analyzeWav(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 12) throw wavError('header is truncated');
  if (readChunkId(buffer, 0) !== 'RIFF' || readChunkId(buffer, 8) !== 'WAVE') {
    throw wavError('must have RIFF/WAVE header');
  }

  const riffSize = buffer.readUInt32LE(4);
  const riffEnd = 8 + riffSize;
  if (riffEnd > buffer.length || riffEnd < 12) throw wavError('RIFF chunk exceeds buffer');

  let offset = 12;
  let fmt = null;
  let dataOffset = null;
  let dataBytes = null;

  while (offset < riffEnd) {
    if (offset + 8 > riffEnd || offset + 8 > buffer.length) {
      throw wavError('chunk header is truncated');
    }
    const id = readChunkId(buffer, offset);
    const size = buffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + size;
    const nextOffset = payloadEnd + (size & 1);
    if (payloadEnd > riffEnd || payloadEnd > buffer.length || nextOffset > riffEnd || nextOffset > buffer.length) {
      throw wavError(`chunk ${id} exceeds buffer`);
    }

    if (id === 'fmt ' && fmt === null) {
      if (size < 16) throw wavError('fmt chunk is truncated');
      fmt = {
        audioFormat: buffer.readUInt16LE(payloadStart),
        channels: buffer.readUInt16LE(payloadStart + 2),
        sampleRate: buffer.readUInt32LE(payloadStart + 4),
        blockAlign: buffer.readUInt16LE(payloadStart + 12),
        bitsPerSample: buffer.readUInt16LE(payloadStart + 14),
      };
    } else if (id === 'data' && dataOffset === null) {
      dataOffset = payloadStart;
      dataBytes = size;
    }
    offset = nextOffset;
  }

  if (fmt === null) throw wavError('fmt chunk is missing');
  if (dataOffset === null || dataBytes === null) throw wavError('data chunk is missing');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) throw wavError('must be PCM 16-bit');
  if (fmt.channels !== 1 && fmt.channels !== 2) throw wavError('channels must be 1 or 2');
  if (!Number.isInteger(fmt.sampleRate) || fmt.sampleRate <= 0) throw wavError('sampleRate must be positive');
  const expectedBlockAlign = fmt.channels * 2;
  if (fmt.blockAlign !== expectedBlockAlign) {
    throw wavError(`blockAlign ${fmt.blockAlign} does not match ${expectedBlockAlign}`);
  }
  if (dataBytes <= 0) throw wavError('data chunk is empty');
  if (dataBytes % fmt.blockAlign !== 0) throw wavError('data bytes are not aligned to blockAlign');

  const sampleCount = dataBytes / 2;
  let sumSquares = 0;
  let maxAbs = 0;
  for (let index = dataOffset; index < dataOffset + dataBytes; index += 2) {
    const normalized = buffer.readInt16LE(index) / 32768;
    const abs = Math.abs(normalized);
    sumSquares += normalized * normalized;
    if (abs > maxAbs) maxAbs = abs;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);

  return {
    format: 'pcm_s16le',
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    sampleCount,
    durationSec: sampleCount / (fmt.sampleRate * fmt.channels),
    rmsDbfs: dbfs(rms),
    peakDbfs: dbfs(maxAbs),
    dataOffset,
    dataBytes,
  };
}

export function analyzeWavFile(filePath) {
  return analyzeWav(readFileSync(filePath));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function relativeAssetPath(fileName) {
  return `content/assets/bgm/${fileName}`;
}

function assetRecord(fileName, assetDir) {
  const filePath = join(assetDir, fileName);
  if (!existsSync(filePath)) throw new Error(`Missing allowed BGM asset: ${relativeAssetPath(fileName)}`);
  const buffer = readFileSync(filePath);
  const analysis = analyzeWav(buffer);
  return {
    fileName,
    relativePath: relativeAssetPath(fileName),
    bytes: statSync(filePath).size,
    sha256: sha256(buffer),
    ...analysis,
  };
}

export function auditBgmAssets({ assetDir = DEFAULT_ASSET_DIR } = {}) {
  const allowed = new Set(BGM_ALLOWLIST);
  const actualWavs = readdirSync(assetDir).filter((name) => name.toLowerCase().endsWith('.wav'));
  const unexpected = actualWavs.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) throw new Error(`Unexpected BGM assets: ${unexpected.join(', ')}`);
  return BGM_ALLOWLIST.map((fileName) => assetRecord(fileName, assetDir));
}

function sameInvariant(before, after, field) {
  return before[field] === after[field];
}

/** Apply one deterministic sample-level gain while preserving the WAV container. */
export function normalizeWavPcm16(buffer, {
  targetRmsDbfs = -23,
  maxPeakDbfs = -1,
  minRmsDbfs = -30,
} = {}) {
  const before = analyzeWav(buffer);
  if (!Number.isFinite(before.rmsDbfs) || !Number.isFinite(before.peakDbfs)) {
    throw new Error('peak safety: silent or invalid source cannot be normalized');
  }
  const desiredGain = 10 ** ((targetRmsDbfs - before.rmsDbfs) / 20);
  const peakLimitedGain = 10 ** ((maxPeakDbfs - before.peakDbfs) / 20);
  const gain = Math.min(desiredGain, peakLimitedGain);
  if (!Number.isFinite(gain) || gain <= 0) throw new Error('peak safety: invalid gain');
  if (gain + Number.EPSILON < desiredGain && before.rmsDbfs + 20 * Math.log10(peakLimitedGain) < minRmsDbfs) {
    throw new Error('peak safety: minimum RMS cannot be reached without exceeding maximum peak');
  }

  const output = Buffer.from(buffer);
  let clippingSamples = 0;
  for (let index = before.dataOffset; index < before.dataOffset + before.dataBytes; index += 2) {
    const source = buffer.readInt16LE(index);
    const rounded = Math.round(source * gain);
    const clamped = Math.max(-32768, Math.min(32767, rounded));
    if (clamped !== rounded) clippingSamples += 1;
    output.writeInt16LE(clamped, index);
  }
  if (clippingSamples > 0) throw new Error(`peak safety: ${clippingSamples} samples would clip`);

  const after = analyzeWav(output);
  if (after.rmsDbfs < minRmsDbfs) throw new Error(`peak safety: normalized RMS ${after.rmsDbfs} is below ${minRmsDbfs}`);
  if (after.peakDbfs > maxPeakDbfs) throw new Error(`peak safety: normalized peak ${after.peakDbfs} exceeds ${maxPeakDbfs}`);
  for (const field of ['sampleRate', 'channels', 'bitsPerSample', 'sampleCount', 'dataBytes']) {
    if (!sameInvariant(before, after, field)) throw new Error(`WAV invariant changed: ${field}`);
  }
  if (output.length !== buffer.length) throw new Error('WAV invariant changed: byte length');
  for (let index = 0; index < buffer.length; index += 1) {
    const inData = index >= before.dataOffset && index < before.dataOffset + before.dataBytes;
    if (!inData && output[index] !== buffer[index]) throw new Error('WAV container changed outside data chunk');
  }
  return output;
}

export function normalizeBgmAssets({
  assetDir = DEFAULT_ASSET_DIR,
  targetRmsDbfs = -23,
  maxPeakDbfs = -1,
  minRmsDbfs = -30,
} = {}) {
  const prepared = [];
  try {
    for (const fileName of BGM_ALLOWLIST) {
      const filePath = join(assetDir, fileName);
      const beforeBuffer = readFileSync(filePath);
      const before = analyzeWav(beforeBuffer);
      const output = normalizeWavPcm16(beforeBuffer, { targetRmsDbfs, maxPeakDbfs, minRmsDbfs });
      const tempPath = join(assetDir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
      writeFileSync(tempPath, output, { flag: 'wx' });
      const after = analyzeWavFile(tempPath);
      if (after.rmsDbfs < minRmsDbfs || after.peakDbfs > maxPeakDbfs) throw new Error(`Validated temporary BGM failed: ${fileName}`);
      prepared.push({
        fileName,
        filePath,
        tempPath,
        before,
        after,
        gain: 10 ** ((after.rmsDbfs - before.rmsDbfs) / 20),
      });
    }
    for (const item of prepared) copyFileSync(item.tempPath, item.filePath);
    return prepared.map(({ tempPath, ...item }) => ({ ...item, sha256: sha256(readFileSync(item.filePath)), bytes: statSync(item.filePath).size }));
  } finally {
    for (const item of prepared) {
      if (existsSync(item.tempPath)) unlinkSync(item.tempPath);
    }
  }
}

function parseNumberArg(args, index, flag) {
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${flag} requires a finite number`);
  return value;
}

function main(args) {
  let json = false;
  let normalize = false;
  let failUnderRmsDbfs = null;
  let targetRmsDbfs = -23;
  let maxPeakDbfs = -1;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--normalize') normalize = true;
    else if (arg === '--fail-under-rms-dbfs') failUnderRmsDbfs = parseNumberArg(args, index++, arg);
    else if (arg === '--target-rms-dbfs') targetRmsDbfs = parseNumberArg(args, index++, arg);
    else if (arg === '--max-peak-dbfs') maxPeakDbfs = parseNumberArg(args, index++, arg);
    else throw new Error(`Unknown option: ${arg}`);
  }
  const result = normalize
    ? { status: 'NORMALIZED', targetRmsDbfs, maxPeakDbfs, files: normalizeBgmAssets({ targetRmsDbfs, maxPeakDbfs }) }
    : { status: 'AUDIT', files: auditBgmAssets() };
  if (failUnderRmsDbfs !== null) {
    const failed = result.files.filter((entry) => entry.after?.rmsDbfs < failUnderRmsDbfs || entry.rmsDbfs < failUnderRmsDbfs);
    result.threshold = { failUnderRmsDbfs, failed: failed.map((entry) => ({ relativePath: entry.relativePath, rmsDbfs: entry.after?.rmsDbfs ?? entry.rmsDbfs })) };
    if (failed.length > 0) process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!json && !normalize) return;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
