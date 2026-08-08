import { describe, expect, it } from 'vitest';
import { RendererPluginHost } from '../src/plugin-host.js';
import type { AdvStage } from '../src/types.js';

const stage: AdvStage = { setBackground() {}, setPortrait() {}, removePortrait() {}, showText() {}, showChoices() {}, hideChoices() {}, setFade() {} };

describe('RendererPluginHost', () => {
  it('isolates a failed plugin and keeps later plugins running', () => {
    const host = new RendererPluginHost();
    const seen: string[] = [];
    host.register({ id: 'bad', onFrame: () => { throw new Error('broken'); } });
    host.register({ id: 'good', onFrame: () => seen.push('good') });
    host.attach(stage);
    host.update(16);
    host.update(16);
    expect(seen).toEqual(['good', 'good']);
    expect(host.diagnostics()).toEqual([{ pluginId: 'bad', message: 'broken' }]);
  });

  it('rejects duplicate and unsupported plugin contracts', () => {
    const host = new RendererPluginHost();
    host.register({ id: 'demo' });
    expect(() => host.register({ id: 'demo' })).toThrow(/duplicate/);
    expect(() => host.register({ id: 'future', apiVersion: 99 })).toThrow(/unsupported/);
  });
});
