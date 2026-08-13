import { describe, expect, it } from 'vitest';
import { analyzeWav, auditBgmAssets, normalizeWavPcm16 } from '../scripts/audio-audit.mjs';

function makeWav({
  audioFormat = 1,
  channels = 2,
  sampleRate = 44100,
  bitsPerSample = 16,
  samples = [0, 0, 16384, -16384],
  includeOddJunk = false,
}: {
  audioFormat?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  samples?: number[];
  includeOddJunk?: boolean;
} = {}): Buffer {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const data = Buffer.alloc(samples.length * bytesPerSample);
  if (bitsPerSample === 16) {
    samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  }
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(audioFormat, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * blockAlign, 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bitsPerSample, 14);
  const chunks: Buffer[] = [Buffer.from('fmt '), Buffer.alloc(4), fmt];
  chunks[1]!.writeUInt32LE(fmt.length, 0);
  if (includeOddJunk) {
    const junk = Buffer.from([0x7f]);
    const junkSize = Buffer.alloc(4);
    junkSize.writeUInt32LE(junk.length, 0);
    chunks.push(Buffer.from('JUNK'), junkSize, junk, Buffer.from([0]));
  }
  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(data.length, 0);
  chunks.push(Buffer.from('data'), dataSize, data);
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

describe('Zero BGM PCM16 analyzer', () => {
  it('拒绝不是 RIFF/WAVE 的输入', async () => {
    const { analyzeWav: currentAnalyzeWav } = await import('../scripts/audio-audit.mjs');
    expect(() => currentAnalyzeWav(Buffer.from('bad'))).toThrow('WAV');
  });

  it('拒绝不是 PCM 16-bit 的 WAV', () => {
    expect(() => analyzeWav(makeWav({ audioFormat: 3 }))).toThrow('PCM 16');
    expect(() => analyzeWav(makeWav({ bitsPerSample: 24 }))).toThrow('PCM 16');
  });

  it('正确处理带奇数未知 chunk 的 stereo PCM16 样本', () => {
    const result = analyzeWav(makeWav({ includeOddJunk: true }));
    expect(result).toMatchObject({
      format: 'pcm_s16le',
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      sampleCount: 4,
      dataBytes: 8,
    });
    expect(result.durationSec).toBeCloseTo(4 / (44100 * 2), 12);
    expect(result.rmsDbfs).toBeCloseTo(-9.0309, 3);
    expect(result.peakDbfs).toBeCloseTo(-6.0206, 3);
  });

  it('拒绝空 data、错误 blockAlign 和越界 chunk', () => {
    expect(() => analyzeWav(makeWav({ samples: [] }))).toThrow('data');
    const badAlign = makeWav();
    badAlign.writeUInt16LE(1, 12 + 8 + 12);
    expect(() => analyzeWav(badAlign)).toThrow('blockAlign');
    const truncated = makeWav();
    truncated.writeUInt32LE(0xffff, 12 + 8 + 16 + 4);
    expect(() => analyzeWav(truncated)).toThrow('chunk');
  });

  it('目标电平计算保持容器和 PCM 结构且不越过峰值安全上限', () => {
    const safeFixture = makeWav({
      channels: 1,
      sampleRate: 8000,
      samples: Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 8000 : -8000)),
      includeOddJunk: true,
    });
    const before = analyzeWav(safeFixture);
    const result = normalizeWavPcm16(safeFixture, {
      targetRmsDbfs: -23,
      maxPeakDbfs: -1,
    });
    const after = analyzeWav(result);
    expect(after.rmsDbfs).toBeGreaterThanOrEqual(-30);
    expect(after.peakDbfs).toBeLessThanOrEqual(-1);
    expect(result.length).toBe(safeFixture.length);
    expect(after.sampleRate).toBe(before.sampleRate);
    expect(after.channels).toBe(before.channels);
    expect(after.bitsPerSample).toBe(before.bitsPerSample);
    expect(after.sampleCount).toBe(before.sampleCount);
    expect(after.durationSec).toBe(before.durationSec);
    for (let index = 0; index < safeFixture.length; index += 1) {
      const inData = index >= before.dataOffset && index < before.dataOffset + before.dataBytes;
      if (!inData) expect(result[index]).toBe(safeFixture[index]);
    }
    expect(normalizeWavPcm16(safeFixture)).toEqual(result);
  });

  it('无法在不削波的情况下达到最低电平时直接失败', () => {
    const hotFixture = makeWav({
      channels: 1,
      sampleRate: 8000,
      samples: Array.from({ length: 4096 }, (_, index) => (index === 0 ? 32767 : 0)),
    });
    expect(() => normalizeWavPcm16(hotFixture, {
      targetRmsDbfs: -23,
      maxPeakDbfs: -1,
    })).toThrow('peak safety');
  });

  it('十首正式 BGM 均达到电平底线且保持 PCM 结构', () => {
    const assets = auditBgmAssets();
    expect(assets).toHaveLength(10);
    for (const asset of assets) {
      expect(asset.rmsDbfs, asset.fileName).toBeGreaterThanOrEqual(-30);
      expect(asset.peakDbfs, asset.fileName).toBeLessThanOrEqual(-1);
      expect(asset.format, asset.fileName).toBe('pcm_s16le');
      expect(asset.sampleRate, asset.fileName).toBe(44100);
      expect(asset.channels, asset.fileName).toBe(2);
      expect(asset.bitsPerSample, asset.fileName).toBe(16);
      expect(asset.sampleCount, asset.fileName).toBe(2822400);
      expect(asset.durationSec, asset.fileName).toBe(32);
      expect(asset.dataOffset, asset.fileName).toBe(78);
      expect(asset.dataBytes, asset.fileName).toBe(5644800);
    }
  });
});
