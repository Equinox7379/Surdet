import { describe, expect, it, vi } from 'vitest';
import { ProjectUiMotionController } from '../src/project-ui-motion.js';
import type { ProjectUiMotion } from '@surdet/core';

const motion: Required<ProjectUiMotion> = { durationMs: 100, opacity: 0, x: 20, y: -10, scale: 0.8, easing: 'linear' };
describe('work UI motion lifecycle', () => {
  it('uses only supplied frames and settles enter/exit once', () => {
    const driver = new ProjectUiMotionController(), paint = vi.fn(), done = vi.fn(), wake = vi.fn();
    driver.setFrameRequest(wake);
    driver.play('settings', motion, 'enter', paint, done);
    expect(paint).toHaveBeenLastCalledWith({ opacity: 0, x: 20, y: -10, scale: 0.8 });
    expect(wake).toHaveBeenCalledOnce();
    driver.update(50);
    expect(paint).toHaveBeenLastCalledWith({ opacity: 0.5, x: 10, y: -5, scale: 0.9 });
    driver.update(60); driver.update(20);
    expect(paint).toHaveBeenLastCalledWith({ opacity: 1, x: 0, y: -0, scale: 1 });
    expect(done).toHaveBeenCalledOnce(); expect(driver.needsUpdate).toBe(false);
    driver.play('settings', motion, 'exit', paint, done); driver.update(100);
    expect(paint).toHaveBeenLastCalledWith({ opacity: 0, x: 20, y: -10, scale: 0.8 });
    expect(done).toHaveBeenCalledTimes(2);
  });
  it('reopening, stale cancellation and reset never complete an old page', () => {
    const driver = new ProjectUiMotionController(), oldDone = vi.fn(), newDone = vi.fn();
    const stale = driver.play('menu', motion, 'exit', () => {}, oldDone);
    driver.play('menu', motion, 'enter', () => {}, newDone); stale(); driver.update(100);
    expect(oldDone).not.toHaveBeenCalled(); expect(newDone).toHaveBeenCalledOnce();
    driver.play('menu', motion, 'exit', () => {}, oldDone); driver.cancelAll(); driver.update(100);
    expect(oldDone).not.toHaveBeenCalled(); expect(driver.needsUpdate).toBe(false);
  });
  it('zero and reduced motion are synchronous terminal projections without a wake-up', () => {
    const driver = new ProjectUiMotionController(), paint = vi.fn(), done = vi.fn(), wake = vi.fn();
    driver.setFrameRequest(wake); driver.play('menu', null, 'enter', paint, done);
    expect(paint).toHaveBeenLastCalledWith({ opacity: 1, x: 0, y: 0, scale: 1 });
    driver.play('menu', { ...motion, durationMs: 0 }, 'exit', paint, done);
    expect(done).toHaveBeenCalledTimes(2); expect(wake).not.toHaveBeenCalled();
    driver.play('menu', motion, 'enter', paint, done); driver.finishAll();
    expect(done).toHaveBeenCalledTimes(3); expect(driver.needsUpdate).toBe(false);
  });
  it('does not complete a page replaced or disposed by its painting callback', () => {
    const driver = new ProjectUiMotionController(), done = vi.fn(), replacement = vi.fn();
    driver.play('menu', motion, 'exit', pose => {
      if (pose.opacity === 0) driver.play('menu', motion, 'enter', () => {}, replacement);
    }, done);
    driver.update(100); expect(done).not.toHaveBeenCalled(); expect(driver.needsUpdate).toBe(true);
    driver.update(100); expect(replacement).toHaveBeenCalledOnce();
    driver.play('menu', motion, 'enter', () => driver.dispose(), done);
    driver.update(100); expect(done).not.toHaveBeenCalled(); expect(driver.needsUpdate).toBe(false);
    expect(() => driver.play('new', motion, 'enter', () => {})).toThrow('disposed');
  });
  it('reports drawing failures and removes only the failed run', () => {
    const driver = new ProjectUiMotionController(), done = vi.fn();
    driver.play('good', motion, 'enter', () => {}, done);
    expect(() => driver.play('bad', motion, 'enter', () => { throw new Error('draw failed'); })).toThrow('draw failed');
    driver.update(100); expect(done).toHaveBeenCalledOnce(); expect(driver.needsUpdate).toBe(false);
  });
});
