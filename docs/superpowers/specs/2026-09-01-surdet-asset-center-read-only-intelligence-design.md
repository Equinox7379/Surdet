# Surdet Asset Center — Read-only Intelligence Design

**Date:** 2026-09-01

**Gate:** `ASSET_CENTER_READ_ONLY_INTELLIGENCE_1`

**Status:** Owner pre-approved for direct implementation

**Predecessor:** `REVIEW_TERMINAL_ATOMICITY_REVIEWED_CLOSURE`

## 1. Decision summary

Surdet will add a first-class top-level **素材** workspace. Its first release is deliberately read-only: it inventories the real files under `content/assets`, explains where they are used, surfaces missing/duplicate/orphaned/unsupported facts, provides local previews, and lets a human jump back to the source that references an asset.

The feature will not enlarge the existing Editor-only inventory into a second authority. A new pure Authoring projection will own asset classification, stable identity, reference extraction, issue derivation, and summary totals. CLI/Agent and Editor consume the same projection. The Editor alone keeps browser `FileSystemFileHandle` values and object URLs for local previews; these are view adapters, not semantic truth.

The existing Script sidebar asset list remains a compact insertion tool. The new Asset Center is the inspection and navigation workspace. Import, move, replace, delete, deduplicate, batch repair, hash-all, package policy changes, cloud synchronization, and marketplace behavior are explicitly deferred to separate gates.

## 2. Confirmed baseline

### 2.1 Shared Authoring catalog

`@surdet/authoring` currently recognizes only backgrounds, portraits, and avatars. `project.assets` and `project.inspect.assets` share that catalog, but the input is only a list of paths. The catalog has no size, usage, missing-reference, duplicate-key, orphan, or unsupported-format facts.

The existing `resolved` field means that a visual file extension is supported. It does not prove that a file can be decoded or loaded at runtime.

### 2.2 Editor-only inventory

The Editor currently merges directory entries, `gallery.json`, and compiled scene instructions in `packages/editor/src/assets.ts`. It supports more visible kinds than Authoring, but it keys the merge by semantic key and can hide same-key physical collisions. Its asset sidebar has no stable source path, file size, persistent selection, fixed inspector, search, filters, or full keyboard path.

`avatar` and `ambience` can be scanned but are omitted from the sidebar display order. This is a real current defect.

### 2.3 Runtime and packaging

Runtime and Shell can list or read project asset files, and packaging copies `content/assets`, but neither is an asset intelligence index. Package metadata contains paths, not the human-facing usage and health projection required here.

### 2.4 Reference sources

Authoring already parses scenes, timelines, characters, and config files. The new projection can therefore derive asset references without adding a database:

- direct scene instructions such as background, portrait, music, sound, voice, ambience, and video;
- timeline background and portrait cues;
- character avatar declarations;
- gallery CG and music source links;
- scene unlock instructions that point to gallery entries.

## 3. Design alternatives

### Alternative A — enlarge the current Editor sidebar

This is the smallest visual change, but it leaves the Editor inventory and Agent catalog as competing truths. It also forces a narrow insertion sidebar to carry overview, filtering, preview, health, and reference-navigation responsibilities.

**Rejected.** It is fast only in the short term and makes future asset writes less safe.

### Alternative B — shared pure projection plus a dedicated Asset Center

Authoring owns one deterministic read model. The Editor adds browser-only preview facts and renders a three-region workspace. Existing Agent capability output grows additively while retaining the three legacy arrays. No persistent cache or new project file is introduced.

**Selected.** It closes the semantic split without changing project formats or creating migration debt.

### Alternative C — persistent asset database or generated manifest

A cache could support thumbnails and very large libraries, but it introduces invalidation, migration, write authority, recovery, and source-control questions before the read model is stable.

**Rejected for Phase 1.** Reconsider only after measured scale proves an in-memory projection insufficient.

## 4. Goals

1. Give ordinary users a Chinese, understandable Asset Center with a mature information hierarchy.
2. Keep a single shared semantic truth for files, keys, references, issues, and totals.
3. Preserve physical file identity even when semantic keys collide.
4. Show all real `content/assets` categories, including avatars, ambience, fonts, and unknown folders.
5. Explain whether an item is used, unused, missing, duplicated, invalidly named, or unsupported.
6. Show exact source references and navigate to scene, timeline, or configuration context.
7. Preview images, audio, and video locally without exposing binary content through Agent Port.
8. Keep protocol fields, paths, hashes, and internal IDs available in structured/collapsed technical information rather than spreading English jargon across the primary UI.
9. Remain usable at 1440 px, 1024 px, and 800 px widths.
10. Preserve every existing script insertion, undo, validation, preview, timeline, review, and save behavior.

## 5. Non-goals

- No import, drag-and-drop ingestion, move, rename, replace, delete, deduplication, or batch cleanup.
- No automatic repair or mutation of scene, timeline, config, gallery, or asset files.
- No asset upload, cloud sync, collaboration, marketplace, plugin, or generative media workflow.
- No generated manifest, SQLite database, cache directory, thumbnail database, or project-format migration.
- No unconditional hashing of all binary files during ordinary inspection.
- No dimensions, duration, codec, waveform, or decode-validity claim unless a later measured gate adds a bounded probe.
- No `public` files mixed into the game asset library. `public` remains application/web support material.
- No copying LetsGal code, brand, colors, icons, assets, text, or MD5 implementation.
- No Wave 7, deployment, release, or destructive Git operation.

## 6. Truth and identity invariants

### 6.1 Asset root

The game asset root is exactly `content/assets`. Paths outside that root do not become game asset items. `public` may receive a separate application-resource view in a future gate.

### 6.2 Physical identity

Each physical item is identified by its normalized project-relative path:

```text
file:content/assets/bg/castle_hall.webp
```

Semantic keys such as `castle_hall` or `lynn:normal` are aliases used for reference matching. They never collapse two different physical paths.

### 6.3 Missing identity

A reference with no physical match creates a stable synthetic item:

```text
missing:<kind>:<normalized-key>
```

Synthetic missing items contain references but no path, bytes, preview handle, or false resolution claim.

### 6.4 Determinism

For the same snapshot and file facts, item order, reference order, issue order, counts, and totals are byte-stable. Paths sort lexically. References sort by source path, line, and source kind. No filesystem enumeration order leaks into the contract.

### 6.5 Read-only behavior

Building, filtering, selecting, previewing, or navigating the Asset Center changes no project file. Browser object URLs are revoked when selection changes or the workspace is disposed.

### 6.6 No hidden collision

If one semantic reference maps to multiple physical paths, all physical items remain visible and receive a duplicate-key issue. The projection does not guess a winner.

## 7. Shared Authoring projection

Create `packages/authoring/src/asset-intelligence.ts` and export it from `packages/authoring/src/index.ts`.

### 7.1 Kinds

```ts
export type ProjectAssetKind =
  | 'background'
  | 'portrait'
  | 'avatar'
  | 'music'
  | 'ambience'
  | 'sound-effect'
  | 'voice'
  | 'video'
  | 'font'
  | 'other';
```

CG and music gallery entries are reference sources, not separate physical files. A CG source resolves to a background key; a gallery music source resolves to a music key. Text gallery entries resolve to scenes and are not assets.

### 7.2 Inputs

```ts
export interface ProjectAssetFileFact {
  path: string;
  bytes?: number;
}

export interface BuildProjectAssetIntelligenceInput {
  snapshot: ProjectSnapshot;
  files: readonly ProjectAssetFileFact[];
}
```

`bytes` is optional so browser, CLI, tests, and future adapters can share the same projection. Missing bytes mean “not measured,” not zero.

### 7.3 Output

```ts
export interface ProjectAssetReference {
  referenceId: string;
  sourceKind: 'scene' | 'timeline' | 'character' | 'gallery';
  sourceLabel: string;
  sourcePath: string;
  line?: number;
  objectRef?: string;
}

export type ProjectAssetIssueCode =
  | 'ASSET_REFERENCE_MISSING'
  | 'ASSET_KEY_DUPLICATE'
  | 'ASSET_NAME_INVALID'
  | 'ASSET_FORMAT_UNSUPPORTED'
  | 'ASSET_UNUSED';

export interface ProjectAssetItem {
  assetId: string;
  kind: ProjectAssetKind;
  key: string;
  sourcePath?: string;
  format?: string;
  bytes?: number;
  variant?: string;
  physical: boolean;
  references: ProjectAssetReference[];
  issues: ProjectAssetIssueCode[];
}

export interface ProjectAssetSummary {
  fileCount: number;
  totalBytes?: number;
  referencedCount: number;
  unusedCount: number;
  missingCount: number;
  duplicateCount: number;
  unsupportedCount: number;
  invalidNameCount: number;
  byKind: Record<ProjectAssetKind, { files: number; bytes?: number }>;
}

export interface ProjectAssetIntelligence {
  items: ProjectAssetItem[];
  summary: ProjectAssetSummary;
  issues: ProjectAssetIssue[];
}
```

The exact committed type may add fields needed by tests, but it may not weaken physical identity, deterministic ordering, or the read-only boundary.

### 7.4 Classification

Known directories map as follows:

| Directory | Kind | Key rule |
| --- | --- | --- |
| `bg` | background | filename stem |
| `portrait` | portrait | strict `role_outfit_expression` |
| `avatar` | avatar | filename stem |
| `bgm` | music | filename stem |
| `ambience` | ambience | filename stem |
| `se` | sound-effect | filename stem |
| `voice` | voice | filename stem |
| `video` | video | filename stem |
| `fonts` / `font` | font | filename stem |
| anything else below `content/assets` | other | filename stem |

Invalid portrait names stay visible as physical items and receive `ASSET_NAME_INVALID`; they are never silently dropped.

### 7.5 Formats

Supported-extension checks are kind-specific and case-insensitive. This check means only “recognized by the project contract.” It does not claim decode success. Unknown extensions remain visible and receive `ASSET_FORMAT_UNSUPPORTED`.

### 7.6 References

The projection extracts references from compiled scene instructions, timeline definitions, character avatar declarations, and gallery source links. Each reference preserves a human label, project-relative source path, source line when available, and stable object reference when the shared object index provides one.

## 8. Existing `project.assets` compatibility

`ProjectAssetCatalog` retains `backgrounds`, `portraits`, and `avatars` for existing timeline and Agent callers. It grows an additive `intelligence` member produced by the shared builder. `project.inspect.assets` and `project.assets` remain byte-equal.

Agent Port continues to expose metadata only. It does not receive arbitrary binary reads, browser handles, object URLs, or local absolute paths. Human labels are localized in Editor; structured enum values remain stable English protocol tokens.

Ordinary projection does not hash binary files. A future explicit integrity action may add bounded hashes without changing the meaning of this read.

## 9. CLI file facts

`NodeProjectStorage` adds a read-only, root-confined file-fact method for already enumerated relative paths. It uses `lstat`/`stat` without following symbolic links outside the project, reports regular-file byte counts, and preserves the existing fail-loud path policy.

The method does not open or decode media and does not change project revision semantics. Binary files remain excluded from the text snapshot revision.

## 10. Editor adapter

`DirAsset` gains normalized `sourcePath`, optional `bytes`, and optional `lastModified`. `FileSystemFileHandle` remains outside the Authoring contract.

After the Editor builds its normal Authoring snapshot, it calls the shared intelligence builder and stores the result in `state.assetIntelligence`. A small adapter maps `sourcePath` back to the matching `DirAsset.handle` for preview.

The old `buildAssetInventory()` ceases to own classification and reference semantics. The Script sidebar consumes the shared items and keeps only compact insert/copy behavior.

## 11. Human information architecture

The new main mode order is:

```text
剧本 · 素材 · 流程 · 时间轴 · 配置 · 预览 · 审阅 · 统计 · 审计
```

### 11.1 Workspace frame

The workspace uses four calm layers, not a grid of equal cards:

1. **Header:** “素材中心,” project-scoped explanation, search, and view switch.
2. **Overview strip:** total size, files, referenced, unused, and problems. Numbers are compact editorial facts, not colorful dashboard cards.
3. **Library:** left category/status rail plus a central list or grid.
4. **Inspector:** fixed right region for preview, friendly metadata, reference locations, and collapsed technical information.

### 11.2 Chinese-first copy

Primary UI uses terms such as `背景`, `立绘`, `头像`, `音乐`, `环境音`, `音效`, `语音`, `视频`, `字体`, `其他`, `已引用`, `未引用`, `引用缺失`, `同名冲突`, `命名异常`, and `格式待确认`.

Paths, keys, enums, hashes, and internal IDs appear only in the inspector or `技术信息` disclosure. The UI does not translate stable protocol data stored in DOM `data-*` attributes.

### 11.3 Selection and hierarchy

Selection is expressed by one restrained surface/tone and focus ring. No colored left selection bar, top selection bar, rainbow category stripes, gradients, glass panels, oversized pills, AI prose, or decorative metric clutter is allowed.

Whitespace, typography, alignment, and region boundaries provide hierarchy. The visual language follows the editorial workbench already established in Frontend Passes 1–4.

### 11.4 Preview

- Image: contain within a neutral checkerless stage; preserve aspect ratio.
- Audio: native bounded controls plus filename and size.
- Video: native bounded controls without autoplay.
- Font/other/missing: a precise type placeholder; never fabricate a thumbnail.

Preview requires explicit selection and works with keyboard focus. Hover is optional enhancement only.

### 11.5 Reference navigation

Reference rows show a Chinese source label and location. Activating one:

- opens the Script workspace and focuses the referenced line;
- opens the Timeline workspace and selects the referenced timeline when possible;
- opens Configuration for character/gallery sources.

If a location cannot be navigated precisely, the row remains readable and says so; it never silently jumps elsewhere.

### 11.6 Responsive behavior

- At 1440 px: category rail, library, and inspector are simultaneous.
- At 1024 px: inspector narrows and overview facts wrap once.
- At 800 px: category filters become a horizontal/compact control and inspector follows the library in document order. No essential action or text is clipped.

## 12. Accessibility and Agent readability

- Every filter has a programmatic label.
- Asset rows/cards are real buttons or list options with visible focus.
- Search works without pointer input.
- Selected item uses `aria-selected` and a stable `data-asset-id`.
- Status is conveyed by text as well as tone.
- Summary values and current filters are represented in stable DOM attributes.
- References expose `data-source-path`, optional `data-source-line`, and `data-object-ref` without showing raw protocol values as primary copy.
- No essential behavior depends on hover.

## 13. Performance boundary

Phase 1 uses one in-memory deterministic projection. Binary bytes are not read into memory for inventory. Preview loads only the selected file through its existing browser handle.

The central library initially renders the filtered result set directly. Before adding virtualization, measure the real Zero project and a synthetic 500-item fixture. If direct rendering stays responsive, avoid a dependency. If it does not, add bounded windowing in a separate measured task rather than a speculative framework.

## 14. Failure behavior

- No open project: show a clear empty state and an `打开项目` action.
- Snapshot rebuilding: show `正在整理素材…`; keep prior selection only when the same `assetId` still exists.
- Missing file: show the synthetic item and all known references; preview unavailable.
- Duplicate key: show every physical file and a shared conflict explanation; do not choose one.
- Unsupported format: keep the file visible; do not claim it is broken.
- Preview read failure: keep metadata and references visible, revoke any partial object URL, and show a local preview error.
- Malformed gallery/timeline input: use existing project validation evidence; never mutate or repair while rendering.

## 15. Test and evidence strategy

### 15.1 Permanent Authoring contracts

Cover deterministic ordering, all physical kinds, strict portrait names, missing direct references, duplicate physical keys, unused files, gallery sources, character avatars, timeline cues, byte totals, optional byte facts, and legacy-array compatibility.

### 15.2 Permanent Editor contracts

Cover top-level mode, Chinese labels, shared projection consumption, all categories including avatar/ambience, stable selection, search/filter consistency, fixed inspector, keyboard activation, reference navigation, preview URL cleanup, and compact sidebar regression.

### 15.3 Real browser flow

An isolated local project must prove:

1. Asset Center opens as a top-level mode.
2. Counts and total bytes match the fixture.
3. Search and status filters change both visible results and summary text consistently.
4. Selecting image/audio/video items updates the fixed inspector.
5. A missing reference is visible in Chinese.
6. Two same-key files remain distinct and show a collision.
7. A reference click returns to the expected scene line.
8. Keyboard selection works.
9. 1440, 1024, and 800 widths keep all essential regions reachable.
10. Console, page, request, cleanup, and project-mutation channels stay clean.

Browser validation uses isolated Microsoft Playwright CLI with the repository-external config. It never attaches to a personal browser profile.

## 16. Delivery and stop boundary

The gate is complete only when:

- the shared projection and additive Agent contract are permanent-test green;
- the Script sidebar consumes shared truth without losing insert/copy/undo behavior;
- the Chinese Asset Center and reference navigation are browser-proven;
- affected workspaces pass tests, typecheck, and build;
- one final aggregate verification passes or its first unrelated failure is preserved and reported honestly;
- an independent Luna review finds no blocker/high issue;
- exact scoped commits are created and ordinary push succeeds;
- the untracked long-term ledger is append-only updated after reviewed closure.

Completion does not authorize asset writes, package-policy mutation, release, deployment, Wave 7, or destructive Git operations.
