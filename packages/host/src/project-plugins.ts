import { assertPluginSnapshots, isJsonSafeValue, readProjectPlugins, type Interpreter, type PluginValues,
  type ProjectPluginDeclaration, type ProjectPluginHooks, type ProjectPluginSnapshots, type VariableStore, type VarValue } from '@surdet/core';
import type { RendererPlugin, RendererPluginHost, RendererRuntime } from '@surdet/renderer';
import type { DefaultHostController, HostSystemAdapter } from './types.js';

export interface ProjectPluginContext {
  readonly signal: ProjectPluginSignal;
  readonly renderer: RendererRuntime | undefined;
  getVariable(name: string): VarValue;
  setVariable(name: string, value: VarValue): void;
  getState(): unknown;
  setState(value: unknown): void;
}
/** Native AbortSignal's narrow portable surface; Host's build does not include DOM types. */
export interface ProjectPluginSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
interface PluginAbortController { readonly signal: ProjectPluginSignal; abort(): void }
const newAbortController = (): PluginAbortController => new (globalThis as unknown as { AbortController: new () => PluginAbortController }).AbortController();
export interface ProjectPluginDefinition {
  apiVersion: 1;
  instructions: Record<string, (values: PluginValues, context: ProjectPluginContext) => void | Promise<void>>;
  /** State codecs are pure. Restore returns prepared JSON, never mutates a live plugin object. */
  state?: { initial: unknown; validate(value: unknown): void; save?(value: unknown): unknown; restore?(value: unknown): unknown };
  rendererPlugin?: RendererPlugin;
  setupRenderer?(runtime: RendererRuntime): void | (() => void);
  dispose?(): void;
}
export interface ProjectPluginModule { default: () => ProjectPluginDefinition }
export interface ProjectPluginLoadOptions {
  /** Host-owned explicit permission; never read this from game.config.json. */
  trustedIds: readonly string[];
  loadEntry(entry: string): Promise<ProjectPluginModule>;
  onFailure?(error: Error): void;
}
interface LoadedPlugin { declaration: ProjectPluginDeclaration; definition: ProjectPluginDefinition; state: unknown }
const clone = <T>(value: T): T => (globalThis as unknown as { structuredClone<V>(value: V): V }).structuredClone(value);
function validState(plugin: LoadedPlugin, value: unknown): unknown {
  if (!isJsonSafeValue(value)) throw new Error(`PLUGIN_STATE：插件 ${plugin.declaration.id} 状态必须是 JSON 安全值`);
  const copied = clone(value);
  try { plugin.definition.state?.validate(copied); }
  catch (cause) { throw new Error(`PLUGIN_STATE：插件 ${plugin.declaration.id} 状态校验失败：${String(cause)}`, { cause }); }
  return copied;
}

/** Trusted project code shares its browser/host environment. This is NOT a sandbox. */
export class ProjectPluginHost {
  #loaded = new Map<string, LoadedPlugin>();
  #interpreter: Interpreter | null = null;
  #store: VariableStore | null = null;
  #renderer: RendererRuntime | undefined;
  #host: DefaultHostController | null = null;
  #pending = new Set<PluginAbortController>();
  #cleanup: (() => void)[] = [];
  #disposed = false;
  #failed: string | null = null;
  #preparing = false;
  #generation = 0;

  private constructor(readonly declarations: readonly ProjectPluginDeclaration[], private readonly onFailure?: (error: Error) => void) {}

  static async load(declarations: readonly ProjectPluginDeclaration[], options: ProjectPluginLoadOptions): Promise<ProjectPluginHost> {
    const parsed = readProjectPlugins({ plugins: declarations }), host = new ProjectPluginHost(parsed, options.onFailure);
    const trusted = new Set(options.trustedIds);
    for (const id of trusted) if (!parsed.some(plugin => plugin.id === id)) throw new Error(`PLUGIN_DECLARATION：未声明插件 ${id}`);
    try {
      for (const declaration of parsed) {
        if (!trusted.has(declaration.id)) continue;
        let module: ProjectPluginModule;
        try { module = await options.loadEntry(declaration.entry); }
        catch (error) { throw new Error(`PLUGIN_MISSING：插件 ${declaration.id} 入口 ${declaration.entry} 无法加载：${String(error)}`); }
        if (typeof module.default !== 'function') throw new Error(`PLUGIN_API：插件 ${declaration.id} 必须默认导出工厂函数`);
        const definition = module.default();
        if (!definition || typeof definition !== 'object') throw new Error(`PLUGIN_API：插件 ${declaration.id} 工厂必须返回定义对象`);
        const plugin: LoadedPlugin = { declaration, definition, state: null };
        host.#loaded.set(declaration.id, plugin); // Also owns disposal when later registration fails.
        if (definition.apiVersion !== declaration.apiVersion) throw new Error(`PLUGIN_API：插件 ${declaration.id} API 不一致`);
        for (const instruction of declaration.instructions) if (!Object.hasOwn(definition.instructions ?? {}, instruction.name) || typeof definition.instructions?.[instruction.name] !== 'function') throw new Error(`PLUGIN_API：插件 ${declaration.id} 缺少 @${instruction.name}`);
        if (Object.keys(definition.instructions ?? {}).some(name => !declaration.instructions.some(i => i.name === name))) throw new Error(`PLUGIN_API：插件 ${declaration.id} 注册了未声明指令`);
        if (!!definition.state !== (declaration.stateVersion !== undefined)) throw new Error(`PLUGIN_STATE：插件 ${declaration.id} 状态与声明不一致`);
        if (definition.state) plugin.state = validState(plugin, definition.state.initial);
      }
      return host;
    } catch (error) { host.dispose(); throw error; }
  }

  bind(interpreter: Interpreter, store: VariableStore, host: DefaultHostController, renderer?: RendererRuntime, frames?: RendererPluginHost): void {
    if (this.#disposed || this.#interpreter) throw new Error('项目插件宿主已绑定或已释放');
    this.#interpreter = interpreter; this.#store = store; this.#host = host; this.#renderer = renderer;
    try {
      for (const { declaration, definition } of this.#loaded.values()) {
        if (definition.rendererPlugin) {
          if (!frames || definition.rendererPlugin.id !== declaration.id) throw new Error(`PLUGIN_API：插件 ${declaration.id} 渲染回调缺少宿主或 ID 不一致`);
          const framePlugin = definition.rendererPlugin;
          frames.register({ id: framePlugin.id, apiVersion: framePlugin.apiVersion, onDispose: framePlugin.onDispose ? () => framePlugin.onDispose!() : undefined, onFrame: framePlugin.onFrame ? context => {
            try { framePlugin.onFrame!(context); } catch (error) { throw this.#failure(declaration.id, error); }
          } : undefined });
          this.#cleanup.push(() => { frames.unregister(declaration.id); });
        }
        if (definition.setupRenderer) {
          if (!renderer) throw new Error(`PLUGIN_API：插件 ${declaration.id} 需要渲染器`);
          const cleanup = definition.setupRenderer(renderer); if (cleanup) this.#cleanup.push(cleanup);
        }
      }
      interpreter.setProjectPlugins(this.declarations, this.hooks);
    } catch (error) { this.dispose(); throw error; }
  }

  #context(plugin: LoadedPlugin, controller: PluginAbortController): ProjectPluginContext {
    const generation = this.#generation;
    const active = () => {
      if (this.#disposed || this.#preparing || this.#failed || controller.signal.aborted || generation !== this.#generation) throw new Error('PLUGIN_INACTIVE：插件操作已结束或属于旧运行');
    };
    return {
      signal: controller.signal, renderer: this.#renderer,
      getVariable: name => { active(); return clone(this.#store!.get(name)); },
      setVariable: (name, value) => { active(); this.#store!.set(name, value); },
      getState: () => { active(); return clone(plugin.state); },
      setState: value => { active(); if (!plugin.definition.state) throw new Error('PLUGIN_STATE：该插件未声明可保存状态'); plugin.state = validState(plugin, value); },
    };
  }

  #failure(pluginId: string, error: unknown): Error {
    this.#failed = `PLUGIN_EXECUTION：插件 ${pluginId} 执行失败：${error instanceof Error ? error.message : String(error)}`;
    this.#interpreter?.failHost(); this.cancelPending(); const failure = new Error(this.#failed);
    this.onFailure?.(failure); return failure;
  }

  get failure(): string | null { return this.#failed; }

  /** Blocking instructions use the existing one-active-system router, not another pause loop. */
  adapters(): HostSystemAdapter[] {
    return [...this.#loaded.values()].flatMap(plugin => plugin.declaration.instructions.filter(i => i.blocking).map(instruction => ({
      id: `plugin:${plugin.declaration.id}:${instruction.name}`,
      open: async (values: unknown, context) => {
        const controller = newAbortController(); this.#pending.add(controller);
        try {
          await plugin.definition.instructions[instruction.name]!(values as PluginValues, this.#context(plugin, controller));
          if (!controller.signal.aborted) {
            // Completion may synchronously execute @autosave. Release this operation first.
            this.#pending.delete(controller); controller.abort(); context.resume();
          }
        } catch (error) { if (!controller.signal.aborted) context.fail(this.#failure(plugin.declaration.id, error)); }
        finally { controller.abort(); this.#pending.delete(controller); }
      },
      reset: () => this.cancelPending(),
    })));
  }

  readonly hooks: ProjectPluginHooks = {
    execute: (declaration, instruction, values) => {
      if (this.#disposed || this.#failed) throw new Error(this.#failed ?? 'PLUGIN_INACTIVE：插件已释放');
      const plugin = this.#loaded.get(declaration.id);
      if (!plugin) throw new Error(`PLUGIN_REQUIRED：指令 @${instruction.name} 需要明确启用插件 ${declaration.id}`);
      if (instruction.blocking) {
        void this.#host!.routeSystem(`plugin:${declaration.id}:${instruction.name}`, values).then(accepted => {
          if (!accepted && !this.#disposed && !this.#failed) this.#failure(declaration.id, '宿主未接受插件指令');
        });
      } else {
        const controller = newAbortController();
        try {
          const result = plugin.definition.instructions[instruction.name]!(values, this.#context(plugin, controller));
          if (result && typeof result.then === 'function') {
            void result.catch(() => {}); // Consume rejection; async nonblocking execution is rejected, never resumed.
            throw new Error('非阻塞指令必须同步完成；异步指令请声明 blocking=true');
          }
        } catch (error) { throw this.#failure(declaration.id, error); }
        finally { controller.abort(); }
      }
    },
    snapshot: () => {
      if (this.#disposed || this.#failed || this.#pending.size) throw new Error(this.#failed ?? 'PLUGIN_BUSY：插件交互尚未完成，不能创建可续接存档');
      const snapshot: ProjectPluginSnapshots = {};
      for (const plugin of this.#loaded.values()) if (plugin.definition.state) {
        let value: unknown;
        try { value = plugin.definition.state.save ? plugin.definition.state.save(clone(plugin.state)) : clone(plugin.state); }
        catch (cause) { throw new Error(`PLUGIN_STATE：插件 ${plugin.declaration.id} 状态保存失败：${String(cause)}`, { cause }); }
        snapshot[plugin.declaration.id] = { version: plugin.declaration.stateVersion!, value };
      }
      assertPluginSnapshots(snapshot); return snapshot;
    },
    prepareRestore: snapshot => {
      if (this.#disposed) throw new Error('PLUGIN_INACTIVE：插件已释放');
      assertPluginSnapshots(snapshot);
      for (const [id, saved] of Object.entries(snapshot)) {
        const plugin = this.#loaded.get(id);
        if (!plugin?.definition.state) throw new Error(`PLUGIN_REQUIRED：存档需要插件 ${id}`);
        if (saved.version !== plugin.declaration.stateVersion) throw new Error(`PLUGIN_VERSION：插件 ${id} 状态版本 ${saved.version} 不受支持`);
      }
      const prepared = new Map<string, unknown>(); this.#preparing = true;
      try {
        for (const [id, plugin] of this.#loaded) if (plugin.definition.state) {
          const saved = snapshot[id];
          let value: unknown;
          try { value = saved ? (plugin.definition.state.restore ? plugin.definition.state.restore(clone(saved.value)) : saved.value) : plugin.definition.state.initial; }
          catch (cause) { throw new Error(`PLUGIN_STATE：插件 ${id} 状态恢复失败：${String(cause)}`, { cause }); }
          prepared.set(id, validState(plugin, value));
        }
      } finally { this.#preparing = false; }
      return () => { this.cancelPending(); this.#failed = null; for (const [id, value] of prepared) this.#loaded.get(id)!.state = value; };
    },
  };

  cancelPending(): void { this.#generation++; for (const controller of this.#pending) controller.abort(); this.#pending.clear(); }
  resetState(): void { this.hooks.prepareRestore({})(); }
  dispose(): void {
    if (this.#disposed) return; this.#disposed = true; this.cancelPending();
    const failures: unknown[] = [];
    for (const cleanup of this.#cleanup.splice(0).reverse()) try { cleanup(); } catch (error) { failures.push(error); }
    for (const plugin of this.#loaded.values()) try { plugin.definition.dispose?.(); } catch (error) { failures.push(error); }
    this.#loaded.clear(); if (failures.length) throw new AggregateError(failures, '项目插件释放失败');
  }
}
