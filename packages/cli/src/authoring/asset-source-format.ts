import * as path from 'node:path';
import { AGENT_IMAGE_EXTENSIONS, AuthoringOperationError } from '@surdet/authoring';

/** Bounded container inspection, NOT a decoder or a promise of browser support. */
export function validateAssetSourceFormat(bytes: Buffer, fileName: string): void {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const ascii = (start: number, end: number) => bytes.toString('ascii', start, end);
  let valid = false;
  switch (extension) {
    case 'png':
      valid = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && ascii(12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
      break;
    case 'jpg': case 'jpeg':
      valid = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
      break;
    case 'webp':
      valid = bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
      break;
    case 'wav': {
      if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) break;
      let format = false;
      let data = false;
      let offset = 12;
      while (offset + 8 <= bytes.length) {
        const size = bytes.readUInt32LE(offset + 4);
        const end = offset + 8 + size;
        if (end > bytes.length) break;
        if (ascii(offset, offset + 4) === 'fmt ' && size >= 16) {
          format = bytes.readUInt16LE(offset + 10) > 0 && bytes.readUInt32LE(offset + 12) > 0;
        }
        if (ascii(offset, offset + 4) === 'data' && size > 0) data = true;
        offset = end + (size % 2);
      }
      valid = format && data && offset === bytes.length;
      break;
    }
    case 'ogg': {
      if (bytes.length < 28 || ascii(0, 4) !== 'OggS' || bytes[4] !== 0) break;
      const count = bytes[26]!;
      if (count === 0 || 27 + count > bytes.length) break;
      const start = 27 + count;
      const size = bytes.subarray(27, start).reduce((sum, value) => sum + value, 0);
      valid = start + size <= bytes.length && size >= 8
        && (ascii(start, start + 8) === 'OpusHead' || bytes[start] === 1 && ascii(start + 1, start + 7) === 'vorbis');
      break;
    }
    case 'mp3': {
      let offset = 0;
      if (ascii(0, 3) === 'ID3') {
        if (bytes.length < 10 || bytes[3]! < 2 || bytes[3]! > 4 || bytes.subarray(6, 10).some(value => value >= 128)) break;
        offset = 10 + bytes.subarray(6, 10).reduce((size, value) => size * 128 + value, 0);
        if (bytes[3] === 4 && (bytes[5]! & 16) !== 0) offset += 10;
      }
      valid = offset + 4 < bytes.length && bytes[offset] === 255 && (bytes[offset + 1]! & 224) === 224
        && (bytes[offset + 1]! & 24) !== 8 && (bytes[offset + 1]! & 6) === 2
        && (bytes[offset + 2]! & 240) !== 0 && (bytes[offset + 2]! & 240) !== 240 && (bytes[offset + 2]! & 12) !== 12;
      break;
    }
    case 'mp4': {
      let offset = 0;
      let fileType = false;
      let movie = false;
      let data = false;
      while (offset + 8 <= bytes.length) {
        let size = bytes.readUInt32BE(offset);
        let header = 8;
        if (size === 1) {
          if (offset + 16 > bytes.length) break;
          const large = bytes.readBigUInt64BE(offset + 8);
          if (large > BigInt(bytes.length - offset)) break;
          size = Number(large);
          header = 16;
        } else if (size === 0) size = bytes.length - offset;
        if (size < header || offset + size > bytes.length) break;
        const type = ascii(offset + 4, offset + 8);
        if (type === 'ftyp' && size >= header + 8) fileType = true;
        if (type === 'moov' && size > header) movie = true;
        if (type === 'mdat' && size > header) data = true;
        offset += size;
      }
      valid = fileType && movie && data && offset === bytes.length;
      break;
    }
    case 'webm': {
      // EBML header's DocType element must identify WebM, not arbitrary Matroska.
      if (bytes.length < 16 || bytes.readUInt32BE(0) !== 0x1a45dfa3) break;
      const readVint = (offset: number, keepMarker = false): { value: number; next: number } | null => {
        const first = bytes[offset];
        if (!first) return null;
        let marker = 128;
        let width = 1;
        while ((first & marker) === 0) { marker >>= 1; width++; }
        if (offset + width > bytes.length) return null;
        let value = keepMarker ? first : first & (marker - 1);
        for (let index = 1; index < width; index++) value = value * 256 + bytes[offset + index]!;
        return Number.isSafeInteger(value) ? { value, next: offset + width } : null;
      };
      const header = readVint(4);
      if (!header || header.next + header.value >= bytes.length) break;
      const end = header.next + header.value;
      let offset = header.next;
      let webm = false;
      while (offset < end) {
        const id = readVint(offset, true);
        const size = id && readVint(id.next);
        if (!id || !size || size.next + size.value > end) break;
        if (id.value === 0x4282) webm = ascii(size.next, size.next + size.value) === 'webm';
        offset = size.next + size.value;
      }
      valid = webm && offset === end;
      break;
    }
    case 'ttf': case 'otf': {
      if (bytes.length < 12 || (bytes.readUInt32BE(0) !== 0x00010000 && ascii(0, 4) !== 'OTTO')) break;
      const count = bytes.readUInt16BE(4);
      valid = count > 0 && 12 + count * 16 <= bytes.length;
      for (let index = 0; valid && index < count; index++) {
        const record = 12 + index * 16;
        const offset = bytes.readUInt32BE(record + 8);
        const length = bytes.readUInt32BE(record + 12);
        valid = offset >= 12 + count * 16 && offset + length <= bytes.length;
      }
      break;
    }
    case 'woff2':
      valid = bytes.length >= 48 && ascii(0, 4) === 'wOF2' && bytes.readUInt32BE(8) === bytes.length
        && bytes.readUInt16BE(12) > 0 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) < bytes.length - 48;
      break;
  }
  if (!valid) throw new AuthoringOperationError(
    (AGENT_IMAGE_EXTENSIONS as readonly string[]).includes(extension) ? 'ASSET_IMAGE_INVALID' : 'ASSET_MEDIA_INVALID',
    `素材 ${fileName} 的扩展名、容器头或长度不匹配；不会自动转码。`,
    { fileName, format: extension, validation: 'container-header' },
  );
}
