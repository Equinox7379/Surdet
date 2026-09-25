import { expect, it } from 'vitest';
import { validateAssetSourceFormat } from '../src/authoring/asset-source-format.js';

const wav = Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000', 'hex');
const mp3 = Buffer.concat([Buffer.from([255, 251, 144, 0]), Buffer.alloc(413)]);
function box(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + data.length); header.write(type, 4);
  return Buffer.concat([header, data]);
}
function font(signature: string): Buffer {
  const data = Buffer.alloc(32);
  if (signature === 'ttf') data.writeUInt32BE(0x00010000); else data.write(signature);
  data.writeUInt16BE(1, 4); data.write('head', 12); data.writeUInt32BE(28, 20); data.writeUInt32BE(4, 24);
  return data;
}
const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(22), Buffer.from([1, 8]), Buffer.from('OpusHead')]);
const woff2 = Buffer.alloc(60);
woff2.write('wOF2'); woff2.writeUInt32BE(60, 8); woff2.writeUInt16BE(1, 12); woff2.writeUInt32BE(4, 20);

// These are intentionally container-only fixtures. A passing probe does not
// claim these artificial payloads decode; real playback is a separate test.
const containers = [
  ['雨 声.WAV', wav], ['voice.mp3', mp3], ['voice.ogg', ogg],
  ['intro.mp4', Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.from('payload')), box('mdat', Buffer.from('data'))])],
  ['intro.webm', Buffer.from('1a45dfa34008428240047765626d1853806700', 'hex')],
  ['text.ttf', font('ttf')], ['text.otf', font('OTTO')], ['text.woff2', woff2],
] as const;

it.each(containers)('recognizes supported container facts for %s, not decoding', (name, bytes) => {
  expect(() => validateAssetSourceFormat(bytes, name)).not.toThrow();
});

it.each(containers)('rejects empty and truncated headers with a file-specific error: %s', (name, bytes) => {
  for (const bad of [Buffer.alloc(0), bytes.subarray(0, 3)]) {
    expect(() => validateAssetSourceFormat(bad, name)).toThrow(expect.objectContaining({ code: 'ASSET_MEDIA_INVALID', details: expect.objectContaining({ fileName: name }) }));
  }
});

it('does not confuse audio, image and font containers or accept unbounded chunk/table lengths', () => {
  expect(() => validateAssetSourceFormat(wav, 'renamed.mp3')).toThrow();
  expect(() => validateAssetSourceFormat(wav, 'renamed.png')).toThrow(expect.objectContaining({ code: 'ASSET_IMAGE_INVALID' }));
  const badWav = Buffer.from(wav); badWav.writeUInt32LE(0xffffffff, 40);
  const badFont = font('ttf'); badFont.writeUInt32BE(0xffffffff, 24);
  const badMp4 = box('ftyp', Buffer.from('isom0000')); badMp4.writeUInt32BE(0xffffffff);
  for (const [name, bytes] of [['bad.wav', badWav], ['bad.ttf', badFont], ['bad.mp4', badMp4]] as const) {
    expect(() => validateAssetSourceFormat(bytes, name)).toThrow();
  }
});

it('reads ID3v2.4 size and footer before looking for the MPEG Layer III frame', () => {
  const header = Buffer.from([73, 68, 51, 4, 0, 16, 0, 0, 0, 2]);
  const bytes = Buffer.concat([header, Buffer.alloc(2), Buffer.alloc(10), mp3]);
  expect(() => validateAssetSourceFormat(bytes, 'tagged.mp3')).not.toThrow();
  header[9] = 255;
  expect(() => validateAssetSourceFormat(Buffer.concat([header, mp3]), 'bad.mp3')).toThrow();
});

it('accepts the two OpenType sfnt outlines without treating the suffix as an outline requirement', () => {
  expect(() => validateAssetSourceFormat(font('ttf'), 'true-type.otf')).not.toThrow();
  expect(() => validateAssetSourceFormat(font('OTTO'), 'cff.ttf')).not.toThrow();
});

it('requires WebM DocType in the actual EBML header, including multi-byte lengths', () => {
  expect(() => validateAssetSourceFormat(Buffer.from('1a45dfa3874282847765626d1853806700', 'hex'), 'normal.webm')).not.toThrow();
  expect(() => validateAssetSourceFormat(Buffer.from('1a45dfa3874282846e6f70651853806700', 'hex'), 'not-webm.webm')).toThrow();
});
