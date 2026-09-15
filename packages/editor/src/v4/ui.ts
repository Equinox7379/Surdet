import { state, h, setStatus, type TimelineCueSelection } from '../state.js';
import type { EditorModeId } from '../shell/editor-modes.js';
import type { DirAsset } from '../assets.js';

export interface V4Navigation {
  onMode: (mode: EditorModeId) => void;
  onTimeline: (id: string, cue?: TimelineCueSelection) => void;
  onAsset: (id: string) => void;
}
let navigation: V4Navigation | null = null;
export function bindV4Navigation(value: V4Navigation): void { navigation = value; }
export function navigateMode(mode: EditorModeId): void { navigation?.onMode(mode); }
export function navigateTimeline(id: string, cue?: TimelineCueSelection): void { navigation?.onTimeline(id, cue); }
export function revealAsset(id: string): void { navigation?.onAsset(id); }

export function button(label: string, action: () => void, className = 'v4-button'): HTMLButtonElement {
  const control = h('button', className, label);
  control.type = 'button';
  control.onclick = () => {
    if (!control.isConnected || control.closest('[inert]') !== null) return;
    try { action(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), false, 6000); }
  };
  return control;
}
export function disclosure(title: string, content: Node): HTMLDetailsElement {
  const details = h('details', 'v4-disclosure');
  details.append(h('summary', undefined, title), content);
  return details;
}
export function field(label: string, control: HTMLElement): HTMLElement {
  const nativeField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName);
  const result = nativeField ? h('label', 'v4-field') : h('div', 'v4-field');
  if (!nativeField) control.setAttribute('role', 'group');
  result.append(h('span', undefined, label), control);
  control.setAttribute('aria-label', label);
  return result;
}
export function allowedToEdit(node: HTMLElement): boolean {
  return node.isConnected && !state.projectLoading && state.projectWriteLock === null && node.closest('[inert]') === null;
}

/** Component-local image ownership. Does not interfere with Asset Center's singleton thumbnail session. */
export class ImageScope {
  private urls = new Set<string>();
  private disposed = false;
  private pending = new Map<HTMLElement, () => Promise<void>>();
  private observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const host = entry.target as HTMLElement;
      if (!host.isConnected) { this.cancel(host); continue; }
      if (!entry.isIntersecting) continue;
      const load = this.pending.get(host);
      this.cancel(host);
      if (load) void load();
    }
  }, { rootMargin: '160px' });
  cancel(host: HTMLElement): void { this.observer?.unobserve(host); this.pending.delete(host); }
  async image(host: HTMLElement, source: DirAsset | undefined, alt: string, fit: 'cover' | 'contain' = 'contain'): Promise<void> {
    if (this.disposed) return;
    host.dataset.imageState = 'unavailable';
    if (!source || !source.isImage || source.handle === null) {
      host.append(h('span', 'v4-image-empty', '暂无图像')); return;
    }
    const load = async (): Promise<void> => {
      try {
        const file = await source.handle!.getFile();
        if (this.disposed || !host.isConnected) return;
        const url = URL.createObjectURL(file); this.urls.add(url);
        const img = h('img'); img.alt = alt; img.decoding = 'async'; img.style.objectFit = fit;
        const release = (): void => { if (this.urls.delete(url)) URL.revokeObjectURL(url); };
        img.onload = () => { release(); if (!this.disposed && host.isConnected) host.dataset.imageState = 'ready'; };
        img.onerror = () => {
          release(); if (!this.disposed && host.isConnected) {
            host.dataset.imageState = 'error'; host.replaceChildren(h('span', 'v4-image-empty', '图像不可用'));
          }
        };
        img.src = url; host.replaceChildren(img);
      } catch {
        if (!this.disposed && host.isConnected) {
          host.dataset.imageState = 'error'; host.replaceChildren(h('span', 'v4-image-empty', '读取失败'));
        }
      }
    };
    host.dataset.imageState = 'loading';
    if (!this.observer) await load();
    else { this.pending.set(host, load); this.observer.observe(host); }
  }
  dispose(): void {
    this.disposed = true; this.observer?.disconnect(); this.pending.clear();
    for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear();
  }
}
