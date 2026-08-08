# Surdet Engine Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project uses one execution AI; do not dispatch parallel workers.

**Goal:** 修复审计确认的 5 项 P1 和 10 项 P2，并以《零点之后》的加密 Electron 正式发行包完成最终验收。

**Architecture:** 按“发行安全 → 状态正确性 → 渲染生命周期 → 音频生命周期 → 其余 P2 → 最终发行”的顺序串行实施。所有边界修复采用先验证后提交、资源所有权单一化和纯函数布局；正式包改用受控 `.pack-stage`，不再覆盖既有 `packages/shell/game`。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、PixiJS、Howler、Electron 43、electron-builder、PowerShell。

## Global Constraints

- 仓库：`E:\surdet`；操作系统：Windows；Shell：PowerShell；Node.js：`>=20`。
- 当前工作树有大量既有未提交内容。不得执行 `git reset --hard`、`git clean -fd`、`git checkout -- .` 或批量格式化。
- 只改本计划明确列出的文件；发现重叠的用户改动时先保留并适配，不能覆盖。
- 不删除、移动或改写 `packages/shell/game`；新 staging 只能位于 `packages/shell/.pack-stage`。
- 不删除或迁移 Electron `userData` 下的存档、设置和日志。
- 不 commit、不 push；每个任务末尾用 `git diff --check` 和局部测试形成检查点。
- 不把 `zero-after-midnight`、`prologue` 或正式游戏标题硬编码进通用引擎代码。
- 正式发行必须是 `SURDET_PACK_MODE=release` 且 `encrypted=true`；release 模式下 `SURDET_ENCRYPT=0` 必须失败。
- 设计规格：`docs/superpowers/specs/2026-08-08-engine-audit-remediation-design.md`。

---

## File Map

**新增文件**

- `packages/shell/scripts/pack-policy.mjs`：打包模式、目标身份、staging 根目录安全规则和 metadata 纯函数。
- `packages/shell/test/pack-policy.test.mjs`：打包策略回归测试。
- `packages/renderer/src/ruby-layout.ts`：纯 Ruby 多行布局。
- `packages/renderer/test/ruby-layout.test.ts`：Ruby 布局测试。
- `packages/shell/scripts/benchmark-save-store.mjs`：1/5/9 MiB 真实存档 API 基准。

**修改文件**

- `.gitignore`：忽略 `packages/shell/.pack-stage/`。
- `packages/shell/electron-builder.yml`：从 `.pack-stage/game` 映射到 app.asar `game/`。
- `packages/shell/prepare-pack.mjs`：显式目标、强制 release 加密、安全 staging、metadata。
- `packages/shell/scripts/verify-pack.mjs`：staging/artifact 身份与加密校验。
- `packages/cli/src/index.ts`、`packages/cli/src/pack.ts`、`packages/cli/test/pack.test.ts`：显式 `surdet pack <gameDir>`。
- `packages/core/src/save/save-manager.ts`、`packages/core/test/save.test.ts`、`packages/core/test/interpreter-save.test.ts`：combat/affection 深校验与无部分恢复。
- `packages/core/src/state/types.ts`、`packages/core/src/state/variable-store.ts`、`packages/core/test/variable-store.test.ts`：递归 VarValue、cloneValue 和 setMany。
- `packages/core/src/systems/shop.ts`、`packages/core/test/shop.test.ts`：原子购买。
- `packages/core/src/runtime/interpreter.ts`、`packages/core/test/interpreter.test.ts`：道具数组单次复制。
- `packages/renderer/src/pixi-stage.ts`、`packages/renderer/src/index.ts`、`packages/renderer/test/pixi-stage.test.ts`：补间清理与 Ruby 对象池。
- `packages/renderer/src/audio-manager.ts`、`packages/renderer/test/audio-manager.test.ts`：分声道有界缓存。
- `packages/shell/src/json-file.ts`、`packages/shell/src/main.ts`、`packages/shell/test/json-file.test.ts`：窗口/设置原子 JSON 写入。
- `packages/cli/src/audit.ts`、`packages/cli/test/audit.test.ts`：分支搜索与编译错误可见性。

---

### Task 0: Freeze the Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-08-08-engine-audit-remediation-design.md`
- Read: `docs/PROJECT-GENERAL-MANAGER-HANDOFF-2026-08-08.md`
- Create during execution: none

**Interfaces:**
- Consumes: 当前 Git 工作树和已批准设计。
- Produces: 执行报告中的基线记录；不产生源码接口。

- [ ] **Step 1: Record the protected worktree**

Run:

```powershell
Set-Location E:\surdet
git rev-parse --short HEAD
git status --short --branch
```

Expected: HEAD 被记录；大量 modified/untracked 项被保留，不执行清理。

- [ ] **Step 2: Run the pre-change gate**

Run:

```powershell
npm run typecheck
npm test
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
```

Expected: 全部退出码为 0；模拟仍为 24 条路径、23/23 选择分支、39 次存档往返、3 个结局、0 运行时错误。若基线失败，停止实施并报告，不能把旧失败归因于本轮。

---

### Task 1: Introduce Explicit Pack Policy and Safe Staging (G12)

**Files:**
- Create: `packages/shell/scripts/pack-policy.mjs`
- Create: `packages/shell/test/pack-policy.test.mjs`
- Modify: `.gitignore`
- Modify: `packages/shell/prepare-pack.mjs`
- Modify: `packages/shell/electron-builder.yml`

**Interfaces:**
- Produces: `resolvePackPolicy(env, shellDir)`, `assertSafeStagePath(stageRoot, shellDir)`, `buildPackMetadata(input)`。
- Produces: `.pack-stage/game/release/pack-metadata.json`，供 Task 2 验证。

- [ ] **Step 1: Write failing pack-policy tests**

Create `packages/shell/test/pack-policy.test.mjs` with these cases:

```js
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  resolvePackPolicy,
  assertSafeStagePath,
  buildPackMetadata,
} from '../scripts/pack-policy.mjs';

describe('pack policy', () => {
  const shellDir = path.resolve('E:/surdet/packages/shell');

  it('requires an explicit game directory', () => {
    expect(() => resolvePackPolicy({}, shellDir)).toThrow(/SURDET_GAME_DIR/);
  });

  it('rejects plaintext release packaging', () => {
    expect(() => resolvePackPolicy({
      SURDET_GAME_DIR: 'E:/surdet/examples/zero-after-midnight',
      SURDET_PACK_MODE: 'release',
      SURDET_ENCRYPT: '0',
    }, shellDir)).toThrow(/正式发行.*加密/);
  });

  it('allows explicit plaintext development staging', () => {
    const policy = resolvePackPolicy({
      SURDET_GAME_DIR: 'E:/surdet/examples/starter',
      SURDET_PACK_MODE: 'development',
      SURDET_ENCRYPT: '0',
    }, shellDir);
    expect(policy).toMatchObject({ mode: 'development', encrypted: false });
  });

  it('only accepts the dedicated stage root', () => {
    expect(() => assertSafeStagePath(path.join(shellDir, 'game'), shellDir)).toThrow(/staging/);
    expect(assertSafeStagePath(path.join(shellDir, '.pack-stage'), shellDir))
      .toBe(path.join(shellDir, '.pack-stage'));
  });

  it('builds sorted, identity-bearing metadata', () => {
    expect(buildPackMetadata({
      game: 'zero-after-midnight', version: '0.1.0', title: '零点之后',
      entryScene: 'prologue', sourceDirName: 'zero-after-midnight',
      assetFiles: ['z.png', 'a.png'], mode: 'release', encrypted: true,
    })).toEqual({
      engine: 'surdet', game: 'zero-after-midnight', version: '0.1.0',
      title: '零点之后', entryScene: 'prologue', sourceDirName: 'zero-after-midnight',
      assetFiles: ['a.png', 'z.png'], mode: 'release', encrypted: true,
    });
  });
});
```

- [ ] **Step 2: Verify the tests fail for the missing module**

Run:

```powershell
npx vitest run packages/shell/test/pack-policy.test.mjs
```

Expected: FAIL because `pack-policy.mjs` does not exist.

- [ ] **Step 3: Implement the pure policy module**

Create `packages/shell/scripts/pack-policy.mjs`:

```js
import path from 'node:path';

export function assertSafeStagePath(stageRoot, shellDir) {
  const actual = path.resolve(stageRoot);
  const expected = path.resolve(shellDir, '.pack-stage');
  if (actual !== expected) throw new Error(`[pack] 非法 staging 路径：${actual}`);
  return actual;
}

export function resolvePackPolicy(env, shellDir) {
  const rawGame = env.SURDET_GAME_DIR?.trim();
  if (!rawGame) throw new Error('[pack] 必须显式设置 SURDET_GAME_DIR');
  const mode = env.SURDET_PACK_MODE?.trim() || 'release';
  if (mode !== 'release' && mode !== 'development') {
    throw new Error(`[pack] SURDET_PACK_MODE 仅允许 release/development，得到 ${mode}`);
  }
  const encrypted = env.SURDET_ENCRYPT !== '0';
  if (mode === 'release' && !encrypted) {
    throw new Error('[pack] 正式发行必须启用素材加密，拒绝 SURDET_ENCRYPT=0');
  }
  return {
    gameDir: path.resolve(rawGame),
    stageRoot: assertSafeStagePath(path.join(shellDir, '.pack-stage'), shellDir),
    mode,
    encrypted,
  };
}

export function buildPackMetadata(input) {
  return { engine: 'surdet', ...input, assetFiles: [...input.assetFiles].sort() };
}
```

- [ ] **Step 4: Convert prepare-pack to marker-protected staging**

In `prepare-pack.mjs`, call `resolvePackPolicy(process.env, __dirname)` before any write. Use these exact marker rules:

```js
const markerPath = path.join(stageRoot, '.surdet-staging-root.json');
const marker = { engine: 'surdet', purpose: 'pack-staging' };

if (fs.existsSync(stageRoot)) {
  let existing;
  try { existing = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch { existing = null; }
  if (existing?.engine !== marker.engine || existing?.purpose !== marker.purpose) {
    throw new Error(`[pack] staging 根缺少合法标记，拒绝清理：${stageRoot}`);
  }
  for (const name of fs.readdirSync(stageRoot)) {
    if (name !== '.surdet-staging-root.json') {
      fs.rmSync(path.join(stageRoot, name), { recursive: true, force: true });
    }
  }
} else {
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
}
const dest = path.join(stageRoot, 'game');
fs.cpSync(src, dest, { recursive: true });
```

Generate metadata after assets are copied/encrypted. The metadata `encrypted` value must come from policy, not file inference. Never call `fs.rmSync` on `packages/shell/game`.

- [ ] **Step 5: Point electron-builder at the controlled stage**

Replace `game/**` in `electron-builder.yml` with:

```yaml
  - from: .pack-stage/game
    to: game
    filter:
      - "**/*"
```

Append to `.gitignore`:

```gitignore
packages/shell/.pack-stage/
```

- [ ] **Step 6: Run the local policy gate**

Run:

```powershell
npx vitest run packages/shell/test/pack-policy.test.mjs
$env:SURDET_GAME_DIR='E:\surdet\examples\zero-after-midnight'
$env:SURDET_PACK_MODE='release'
$env:SURDET_ENCRYPT='0'
node packages/shell/prepare-pack.mjs
Remove-Item Env:SURDET_GAME_DIR,Env:SURDET_PACK_MODE,Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
```

Expected: tests PASS; prepare command exits nonzero before writing `.pack-stage/game`. Remove the three task-specific environment variables after the assertion.

---

### Task 2: Verify Pack Identity and Require CLI Target (G12)

**Files:**
- Modify: `packages/shell/scripts/verify-pack.mjs`
- Create: `packages/cli/src/pack.ts`
- Create: `packages/cli/test/pack.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `PackMetadata` produced by Task 1.
- Produces: `cmdPack(gameDirArg: string | undefined, deps?: PackDeps): Promise<number>`; artifact validation of identity, mode and encryption.

- [ ] **Step 1: Add failing CLI target tests**

Create `packages/cli/test/pack.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { cmdPack } from '../src/pack.js';

describe('cmdPack', () => {
  it('rejects a missing target without invoking npm', async () => {
    const run = vi.fn();
    expect(await cmdPack(undefined, { run })).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('passes an explicit absolute target to shell packaging', async () => {
    const run = vi.fn(() => 0);
    expect(await cmdPack('E:/surdet/examples/zero-after-midnight', { run })).toBe(0);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        SURDET_GAME_DIR: expect.stringContaining('zero-after-midnight'),
        SURDET_PACK_MODE: 'release',
      }),
    }));
  });
});
```

- [ ] **Step 2: Implement the testable CLI command**

Create `packages/cli/src/pack.ts` with a dependency-injected runner. The exported contract is:

```ts
export interface PackDeps {
  run(options: { cwd: string; env: NodeJS.ProcessEnv }): number;
}

export async function cmdPack(gameDirArg: string | undefined, deps?: PackDeps): Promise<number>;
```

The missing argument branch writes `surdet pack <gameDir>：必须显式指定游戏目录` to stderr and returns 1. The default runner calls `execSync('npm run pack', { cwd: shellDir, stdio: 'inherit', env })` and returns 0/1. Update `index.ts` to delegate the `pack` case and update help text to `surdet pack <dir>`.

- [ ] **Step 3: Add verifier identity helpers**

In `verify-pack.mjs`, import `extractFile` from `@electron/asar` and add:

```js
function parseJsonBuffer(buffer, label) {
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (error) { fail(`${label} JSON 无效：${String(error)}`); return null; }
}

function verifyIdentity(metadata, config, manifest) {
  if (metadata?.engine !== 'surdet') fail('pack metadata.engine 必须为 surdet');
  if (metadata?.game !== manifest?.game) fail('metadata 与 manifest 游戏 ID 不一致');
  if (metadata?.entryScene !== config?.entryScene) fail('metadata 与配置入口场景不一致');
  if (metadata?.title !== config?.title) fail('metadata 与配置标题不一致');
  if (metadata?.mode !== 'release' || metadata?.encrypted !== true) {
    fail('正式 artifact 必须是 mode=release 且 encrypted=true');
  }
  const expectedGame = process.env.SURDET_EXPECTED_GAME;
  const expectedEntry = process.env.SURDET_EXPECTED_ENTRY;
  if (expectedGame && metadata?.game !== expectedGame) fail(`游戏 ID 不匹配：期望 ${expectedGame}`);
  if (expectedEntry && metadata?.entryScene !== expectedEntry) fail(`入口不匹配：期望 ${expectedEntry}`);
}
```

Preflight reads from `.pack-stage/game`; artifact reads `game/release/pack-metadata.json`, `game/game.config.json`, and `game/release/update-manifest.json` with `extractFile`. Validate every `assetFiles` entry exists as `game/content/assets/<relative>` and require `game/.skey` when `encrypted=true`.

- [ ] **Step 4: Run CLI and verifier tests**

Run:

```powershell
npx vitest run packages/cli/test/pack.test.ts packages/shell/test/pack-policy.test.mjs
npm run typecheck -w @surdet/cli
npm run typecheck -w @surdet/shell
```

Expected: all PASS.

---

### Task 3: Validate Combat and Affection Before Restore (F2)

**Files:**
- Modify: `packages/core/src/save/save-manager.ts`
- Modify: `packages/core/test/save.test.ts`
- Modify: `packages/core/test/interpreter-save.test.ts`

**Interfaces:**
- Produces: stronger existing `assertValidSnapshot(snap)` contract; no new public API.

- [ ] **Step 1: Write failing structural tests**

Add cases to `save.test.ts` asserting rejection of:

```ts
expect(() => assertValidSnapshot(makeSnap({
  systems: { combat: { units: 'bad' } } as never,
}))).toThrow(/systems\.combat\.units/);

expect(() => assertValidSnapshot(makeSnap({
  systems: { affection: { consumed: 123 } } as never,
}))).toThrow(/systems\.affection\.consumed/);

expect(() => assertValidSnapshot(makeSnap({
  systems: { affection: { consumed: ['a'] } },
}))).not.toThrow();
```

Add an interpreter test that snapshots store/read/gallery state before `loadSnapshot(bad)`, expects rejection, then asserts all snapshots are unchanged.

- [ ] **Step 2: Confirm old code accepts the malformed snapshots**

Run:

```powershell
npx vitest run packages/core/test/save.test.ts packages/core/test/interpreter-save.test.ts
```

Expected: new malformed combat/affection tests FAIL.

- [ ] **Step 3: Implement complete structural validators**

Inside `assertValidSnapshot`, add local helpers that call the existing `fail`:

```ts
const finite = (v: unknown, label: string): void => {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${label} 必须是有限 number`);
};
const bool = (v: unknown, label: string): void => {
  if (typeof v !== 'boolean') fail(`${label} 必须是 boolean`);
};
const stringOrNull = (v: unknown, label: string): void => {
  if (v !== null && typeof v !== 'string') fail(`${label} 必须是 string 或 null`);
};
```

Validate every `CombatUnitSnapshot` field listed in `combat.ts`, including finite numeric cooldown values. Validate combat top-level fields and affection arrays. Permit missing `everConsumed` for old saves. Do not validate team membership here; `CombatSolver.restore` owns configuration semantics.

- [ ] **Step 4: Run core regression**

Run:

```powershell
npx vitest run packages/core/test/save.test.ts packages/core/test/interpreter-save.test.ts packages/core/test/combat.test.ts packages/core/test/systems.test.ts
```

Expected: PASS; malformed saves are rejected before any state mutation.

---

### Task 4: Add Atomic Batch State and Fix Shop Purchase (F3)

**Files:**
- Modify: `packages/core/src/state/variable-store.ts`
- Modify: `packages/core/src/systems/shop.ts`
- Modify: `packages/core/test/variable-store.test.ts`
- Modify: `packages/core/test/shop.test.ts`

**Interfaces:**
- Produces: `VariableStore.setMany(updates: readonly { name: string; value: VarValue }[]): void`.
- Consumes in shop: `ShopStoreLike.setMany`.

- [ ] **Step 1: Write failing atomicity tests**

Add to `variable-store.test.ts`:

```ts
it('setMany validates the whole batch before committing', () => {
  const store = new VariableStore([
    { name: 'gold', type: 'number', initial: 100 },
    { name: 'bag', type: 'string[]', initial: [] },
  ]);
  expect(() => store.setMany([
    { name: 'gold', value: 40 },
    { name: 'bag', value: 123 as never },
  ])).toThrow();
  expect(store.getNumber('gold')).toBe(100);
  expect(store.get<string[]>('bag')).toEqual([]);
});

it('setMany rejects duplicate names without mutation', () => {
  const store = new VariableStore([{ name: 'gold', type: 'number', initial: 100 }]);
  expect(() => store.setMany([
    { name: 'gold', value: 90 }, { name: 'gold', value: 80 },
  ])).toThrow(/重复变量/);
  expect(store.getNumber('gold')).toBe(100);
});
```

Add the report's invalid `items:number` reproduction to `shop.test.ts` and assert gold remains 100.

- [ ] **Step 2: Implement setMany**

Add to `VariableStore`:

```ts
setMany(updates: readonly { name: string; value: VarValue }[]): void {
  const seen = new Set<string>();
  const prepared: Array<readonly [string, VarValue]> = [];
  for (const { name, value } of updates) {
    if (seen.has(name)) throw new Error(`setMany: 重复变量 '${name}'`);
    seen.add(name);
    const decl = this.#requireWritable(name);
    assertType(value, decl, 'value');
    prepared.push([name, coerce(decl, value)] as const);
  }
  for (const [name, value] of prepared) this.#values.set(name, value);
}
```

Extend `ShopStoreLike` with this exact signature.

- [ ] **Step 3: Convert buy to a two-phase operation**

Replace the mutating portion with:

```ts
const rawItems = this.#store.get(itemsVar);
if (!Array.isArray(rawItems) || rawItems.some((value) => typeof value !== 'string')) {
  throw new TypeError(`商店背包变量 '${itemsVar}' 必须是 string[]`);
}
const nextItems = rawItems.includes(itemId) ? rawItems : [...rawItems, itemId];
this.#store.setMany([
  { name: goldVar, value: gold - item.price },
  { name: itemsVar, value: nextItems },
]);
```

- [ ] **Step 4: Run state and shop tests**

Run:

```powershell
npx vitest run packages/core/test/variable-store.test.ts packages/core/test/shop.test.ts
```

Expected: PASS; existing duplicate-purchase behavior remains unchanged.

---

### Task 5: Remove Dangling Portrait Tweens (F1)

**Files:**
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/test/pixi-stage.test.ts`

**Interfaces:**
- Produces: private `#detachPortraitSprites(sprites: ReadonlySet<Sprite>): void` used by `removePortrait`.

- [ ] **Step 1: Add failing public-behavior tests**

Use the existing mocked Pixi stage fixtures to cover:

```ts
await stage.setPortrait('a:normal', textureA, { charId: 'a', pos: 'left' });
await stage.setPortrait('a:normal', textureB, { charId: 'a', pos: 'left' });
stage.removePortrait('a');
expect(() => stage.updateEffects(300)).not.toThrow();
```

Add a second case that calls `stage.movePortrait('a', 'right', 300)`, immediately hides, then advances effects. Instrument the Sprite mock so writes to `x` or `alpha` after `destroy()` throw; the old implementation must fail.

- [ ] **Step 2: Implement centralized detach logic**

The helper must:

```ts
#detachPortraitSprites(removed: ReadonlySet<Sprite>): void {
  this.#movTweens = this.#movTweens.filter((tw) => !removed.has(tw.sprite));
  const orphaned = new Set<Sprite>();
  this.#portraitTweens = this.#portraitTweens.filter((tw) => {
    if (!removed.has(tw.old) && !removed.has(tw.neu)) return true;
    if (!removed.has(tw.old)) orphaned.add(tw.old);
    if (!removed.has(tw.neu)) orphaned.add(tw.neu);
    return false;
  });
  const live = new Set(this.#portraitSprites.values());
  for (const sprite of orphaned) {
    if (live.has(sprite) || removed.has(sprite)) continue;
    if (sprite.parent) sprite.parent.removeChild(sprite);
    sprite.destroy();
  }
}
```

`removePortrait` gathers target Sprites, calls this helper before destroying targets, and uses a Set to destroy each target once.

- [ ] **Step 3: Run renderer lifecycle tests**

Run:

```powershell
npx vitest run packages/renderer/test/pixi-stage.test.ts
```

Expected: PASS; no post-destroy property write occurs.

---

### Task 6: Add Ruby Wrapping and Text Pools (F4/F5)

**Files:**
- Create: `packages/renderer/src/ruby-layout.ts`
- Create: `packages/renderer/test/ruby-layout.test.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/test/pixi-stage.test.ts`

**Interfaces:**
- Produces: `layoutRuby(segments, maxWidth, measure, lineHeight): RubyGlyphLayout[]` exactly as defined in the design spec.

- [ ] **Step 1: Write pure failing layout tests**

Cover exact behaviors:

```ts
const mono = { base: (s: string) => s.length * 10, ruby: (s: string) => s.length * 5 };
expect(layoutRuby(parseRuby('甲《こう》乙《おつ》'), 15, mono, 40).map((x) => x.line))
  .toEqual([0, 1]);
expect(layoutRuby(parseRuby('超長語《ちょうちょうご》'), 5, mono, 40)).toHaveLength(1);
expect(layoutRuby(parseRuby('甲《こう》乙'), 100, mono, 40).map((x) => x.base).join(''))
  .toBe('甲乙');
```

Add punctuation cases using the existing `wrapCjk` rules so prohibited punctuation does not begin a new line.

- [ ] **Step 2: Implement the pure layout module**

Implement the interfaces from the spec. Track `x`, `line`, and `y=line*lineHeight`. For a Ruby segment, width is `Math.max(measure.base(base), measure.ruby(ruby))`; keep base and ruby together. For plain segments, split using `wrapCjkMeasure` with remaining width and the supplied base measure.

- [ ] **Step 3: Add explicit Pixi text pools**

In `PixiStage`, add:

```ts
#rubyBasePool: PText[] = [];
#rubyTextPool: PText[] = [];
```

Add `#takeRubyText(pool, index, style): PText` that creates only when `pool[index]` is absent, otherwise updates text/style/position. At the start of a render, hide every pooled object; reveal only used entries. Replace `#clearRubyLayer()` in the normal render path with pool hiding. `destroy()` must destroy both pools and clear arrays.

- [ ] **Step 4: Add pool reuse and overflow integration tests**

Render the same completed Ruby line twice, then a longer suffix. Assert constructor count grows only when capacity grows and does not recreate the first objects. Assert every visible layout item has `x + width <= maxWidth`, except a single explicitly oversized segment.

- [ ] **Step 5: Run Ruby and renderer tests**

Run:

```powershell
npx vitest run packages/renderer/test/ruby-layout.test.ts packages/renderer/test/pixi-stage.test.ts packages/renderer/test/text-wrap.test.ts
```

Expected: PASS.

---

### Task 7: Bound Audio Cache and Separate Channels (S1/S2/G2)

**Files:**
- Modify: `packages/renderer/src/audio-manager.ts`
- Modify: `packages/renderer/test/audio-manager.test.ts`

**Interfaces:**
- Produces private `AudioCacheEntry` and `#evict(channel?)`; public `AudioManager` API remains unchanged.

- [ ] **Step 1: Extend Howler mocks for lifecycle events**

Make mock Howl retain handlers registered through `on`/`once`, expose a test helper `emit(event)`, and make `playing()` configurable per instance.

- [ ] **Step 2: Write failing channel and eviction tests**

Required assertions:

```ts
am.playSe('shared.ogg');
am.playBgm('shared.ogg');
expect(mockHowl).toHaveBeenCalledTimes(2);
```

Create 40 stopped SE sources and assert at most 32 remain loaded by observing `unload`. Create 10 voice sources and assert at most 8 stopped entries remain. Mark candidates playing and prove they are not unloaded. Emit both `end` and `stop`; assert eviction converges and does not unload the same `src` cached in another channel.

- [ ] **Step 3: Replace dual maps with entry cache**

Use:

```ts
type AudioChannel = 'bgm' | 'se' | 'voice';
interface AudioCacheEntry {
  key: string;
  src: string;
  channel: AudioChannel;
  howl: Howl;
  lastUsed: number;
}
const CACHE_LIMITS: Record<AudioChannel, number> = { bgm: 8, se: 32, voice: 8 };
```

Key entries with `${channel}\u0000${src}`. Register `end` and `stop` handlers at creation to call `#evict(channel)`. `#evict` sorts non-playing, non-active candidates by `lastUsed`, removes oldest until the channel count reaches its limit, and calls `unload()` exactly once. `#applyChannelVolume` iterates entries and filters by `entry.channel`.

- [ ] **Step 4: Run full audio tests**

Run:

```powershell
npx vitest run packages/renderer/test/audio-manager.test.ts
```

Expected: PASS, including existing Blob format and BGM epoch tests.

---

### Task 8: Align Recursive VarValue and Remove Item Copy Duplication (S7/S8)

**Files:**
- Modify: `packages/core/src/state/types.ts`
- Modify: `packages/core/src/state/variable-store.ts`
- Modify: `packages/core/src/runtime/interpreter.ts`
- Modify: `packages/core/test/variable-store.test.ts`
- Modify: `packages/core/test/interpreter.test.ts`

**Interfaces:**
- Changes existing `VarValue` to recursive JSON-safe non-null values.
- Consumes existing `VariableStore.getRef` only as a read-only internal reference.

- [ ] **Step 1: Add recursive type/runtime tests**

Add a typed fixture with nested arrays/objects and assert snapshot/restore roundtrip. Add `@add_item`/`@remove_item` behavior tests for a large array and assert no returned `getRef` object is mutated in place.

- [ ] **Step 2: Change VarValue and cloneValue together**

Use exactly:

```ts
export type VarPrimitive = string | number | boolean;
export type VarValue = VarPrimitive | VarValue[] | { [key: string]: VarValue };
```

Replace `cloneValue` object code with:

```ts
function cloneValue(value: VarValue): VarValue {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (typeof value === 'object' && value !== null) {
    const out: { [key: string]: VarValue } = {};
    for (const [key, nested] of Object.entries(value)) out[key] = cloneValue(nested);
    return out;
  }
  return value;
}
```

Do not add null support.

- [ ] **Step 3: Use read-only references for item operations**

For `add_item`, read `this.#store.getRef(vn)`, validate it is a string array, then call `set` with either the unchanged array copy only when required or `[...current, item]`. For `remove_item`, call `set` with `current.filter`. Never call `push` on the `getRef` result.

- [ ] **Step 4: Run core type and interpreter tests**

Run:

```powershell
npm run typecheck -w @surdet/core
npx vitest run packages/core/test/variable-store.test.ts packages/core/test/interpreter.test.ts packages/core/test/save.test.ts
```

Expected: PASS.

---

### Task 9: Share Atomic JSON Writes and Measure Save I/O (S11/S4)

**Files:**
- Create: `packages/shell/src/json-file.ts`
- Create: `packages/shell/test/json-file.test.ts`
- Create: `packages/shell/scripts/benchmark-save-store.mjs`
- Modify: `packages/shell/src/main.ts`
- Modify: `packages/shell/package.json`

**Interfaces:**
- Produces: `writeJsonAtomic(filePath: string, value: unknown, ops?: JsonFileOps): void`；业务调用省略第三参数，测试通过它注入失败。
- Produces benchmark JSON containing sizeMiB, operation, p50Ms, p95Ms.

- [ ] **Step 1: Write failing atomic-write tests**

Test that the helper writes `<file>.tmp`, renames it, leaves valid JSON, and removes no unrelated files. Define `JsonFileOps` as `Pick<typeof fs, 'writeFileSync' | 'renameSync' | 'existsSync' | 'unlinkSync'>`; inject an implementation whose `renameSync` throws, then assert the helper removes only its own `.tmp` and rethrows the original error.

- [ ] **Step 2: Implement and integrate writeJsonAtomic**

Create:

```ts
import * as fs from 'node:fs';

export type JsonFileOps = Pick<typeof fs, 'writeFileSync' | 'renameSync' | 'existsSync' | 'unlinkSync'>;

export function writeJsonAtomic(filePath: string, value: unknown, ops: JsonFileOps = fs): void {
  const tmp = `${filePath}.tmp`;
  ops.writeFileSync(tmp, JSON.stringify(value));
  try { ops.renameSync(tmp, filePath); }
  catch (error) {
    try { if (ops.existsSync(tmp)) ops.unlinkSync(tmp); } catch { /* preserve original error */ }
    throw error;
  }
}
```

Use it for settings and `saveWindowState`. Keep the existing try/catch policy around window-state persistence.

- [ ] **Step 3: Implement the bounded benchmark**

The benchmark must import `FileSaveStore`, create a unique directory with `fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-save-bench-'))`, and generate valid snapshots whose serialized sizes are approximately 1, 5, and 9 MiB, never above `MAX_SAVE_BYTES`. Run write/read/listMeta 20 times per size, use `performance.now()`, sort samples, and print JSON p50/p95. Clean only the exact mkdtemp directory in `finally`.

Add package script:

```json
"benchmark:save": "node scripts/benchmark-save-store.mjs"
```

- [ ] **Step 4: Run durability tests and performance gate**

Run:

```powershell
npx vitest run packages/shell/test/json-file.test.ts packages/shell/test/save-store.test.ts
npm run benchmark:save -w @surdet/shell
```

Expected: tests PASS. If 9 MiB read/write p95 are both `<=50ms`, record results and do not change `FileSaveStore` API. If either exceeds 50ms, stop this task and report that a separate asynchronous I/O design is required; do not improvise it inside this plan.

---

### Task 10: Make CLI Audit Complete and Error-Visible (G8/G9)

**Files:**
- Modify: `packages/cli/src/audit.ts`
- Modify: `packages/cli/test/audit.test.ts`

**Interfaces:**
- Existing `auditBranches` and `cmdAudit` signatures remain unchanged.
- Produces: `compileAuditEntries(entries, customInstructions)` returning `{ compiled, sceneSources, errors }` so unexpected second-pass compile errors can be tested without mocking filesystem globals.

- [ ] **Step 1: Write the >32 instruction regression**

Construct a compiled choice whose option block contains 33 harmless instructions followed by `@goto branch`; assert `auditBranches` still examines that target and reports the expected thin branch finding.

- [ ] **Step 2: Write the compile-error visibility regression**

Extract the scene compile loop into:

```ts
export interface AuditSourceEntry { id: string; file: string; source: string }
export function compileAuditEntries(
  entries: readonly AuditSourceEntry[],
  customInstructions: readonly string[],
): {
  compiled: Map<string, CompiledScene>;
  sceneSources: Map<string, string>;
  errors: Array<{ file: string; message: string }>;
}
```

Pass one valid and one invalid entry and assert the invalid file/message appears in `errors`. `cmdAudit` must print every returned error and return 1 before computing statistics.

- [ ] **Step 3: Remove the hard limit and silent catch**

Change the loop condition from:

```ts
k < end && k < opt.blockStart + 32
```

to:

```ts
k < end
```

Stop at the existing semantic boundaries. In `cmdAudit`, collect compile failures, print each with `✗ <file>: <message>`, and return 1 before content statistics if any failure exists.

- [ ] **Step 4: Run CLI audit tests**

Run:

```powershell
npx vitest run packages/cli/test/audit.test.ts
npm run typecheck -w @surdet/cli
```

Expected: PASS.

---

### Task 11: Full Repository and Formal Release Acceptance

**Files:**
- Planned source modifications: none; failures return execution to the owning Task rather than being patched in this acceptance task.
- Produce: execution report in the final response; do not create a second handoff unless requested.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified release artifacts and evidence.

- [ ] **Step 1: Run every non-release gate**

Run exactly:

```powershell
Set-Location E:\surdet
npm run typecheck
npm test
npm run lint -w surdet-starter
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run verify:p1p2
npm run e2e -w @surdet/shell
git diff --check
```

Expected: every command exits 0. The known Vite chunk-size message remains a warning, not a failure.

- [ ] **Step 2: Prove plaintext release is blocked**

Run:

```powershell
$env:SURDET_GAME_DIR='E:\surdet\examples\zero-after-midnight'
$env:SURDET_EXPECTED_GAME='zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY='prologue'
$env:SURDET_PACK_MODE='release'
$env:SURDET_ENCRYPT='0'
node packages/shell/prepare-pack.mjs
```

Expected: nonzero exit with the release-encryption error and no rewritten `.pack-stage/game`.

- [ ] **Step 3: Build the explicit encrypted formal package**

Run:

```powershell
Remove-Item Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
$env:SURDET_GAME_DIR='E:\surdet\examples\zero-after-midnight'
$env:SURDET_EXPECTED_GAME='zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY='prologue'
$env:SURDET_PACK_MODE='release'
npm run build -w zero-after-midnight
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
```

Expected: portable, installer and win-unpacked artifacts are rebuilt; artifact identity is `zero-after-midnight`, entry is `prologue`, metadata is `mode=release`, `encrypted=true`, all declared assets and `game/.skey` exist.

- [ ] **Step 4: Launch the actual unpacked application**

Run:

```powershell
& 'E:\surdet\packages\shell\release\win-unpacked\Surdet Game.exe'
```

Manually verify: title is 《零点之后》; prologue starts; no programmatic placeholder replaces formal art; fonts, BGM and SE load; F5 quick save and F9 quick load succeed; no Pixi/CSP/Howler/font error appears.

- [ ] **Step 5: Audit the final worktree and report**

Run:

```powershell
git status --short --branch
git diff --stat
git diff --check
```

Expected: only planned files plus pre-existing user changes are present. Report conclusion, changed files, every verification result, S4 p50/p95, remaining risks, and absolute artifact paths. Do not commit or push.

---

## Execution Stop Conditions

The execution AI must stop and report instead of improvising when:

- `.pack-stage` exists without the exact safety marker.
- a planned file contains overlapping user edits that cannot be preserved safely.
- S4 crosses the 50ms p95 threshold and therefore requires a separate async-I/O design.
- formal packaging would require disabling encryption.
- any operation would delete or move `packages/shell/game`, userData, or unrelated untracked files.
- the final artifact cannot prove its game identity from metadata/config/manifest.

## Final Delivery Format

1. **结论**：完成、部分完成或阻塞原因。
2. **改动**：按 Task 列出文件与行为变化。
3. **验证**：列出实际命令、退出码、测试数量、模拟覆盖和 S4 基准。
4. **发行证据**：游戏 ID、entryScene、mode、encrypted、素材数、app.asar 校验、真实启动结果。
5. **风险**：仅列仍存在且有证据的风险。
6. **产物**：便携版、安装版、win-unpacked 程序的绝对路径。
