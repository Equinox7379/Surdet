import { describe, expect, it } from 'vitest';
import { clonePreviewFontsForTransfer } from '../src/panels/preview-panel.js';

describe('preview font transfer boundary', () => {
  it('keeps cached buffers reusable across repeated transferable sends', () => {
    const cached = {
      body: {
        buffer: new Uint8Array([1, 2, 3, 4]).buffer,
        mime: 'font/woff2',
        version: '1:4',
      },
    } as const;

    const first = clonePreviewFontsForTransfer(cached);
    expect(first.body?.buffer).not.toBe(cached.body.buffer);
    expect(first.body?.buffer.byteLength).toBe(4);

    structuredClone(first, { transfer: [first.body!.buffer] });
    expect(first.body?.buffer.byteLength).toBe(0);
    expect(cached.body.buffer.byteLength).toBe(4);

    const second = clonePreviewFontsForTransfer(cached);
    expect(second.body?.buffer.byteLength).toBe(4);
    expect([...new Uint8Array(second.body!.buffer)]).toEqual([1, 2, 3, 4]);
  });
});
