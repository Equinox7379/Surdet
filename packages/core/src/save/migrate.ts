/**
 * 存档 schema 迁移管线（自我迭代 第一梯队③）：
 *  旧档（schemaVersion < 当前版本）在读档时按 from→to 逐级迁移到最新版本，
 *  宿主无需关心细节，引擎演进存档结构不伤玩家旧档。
 *  迁移表约定：每条 from→to 单步推进；apply 只做结构补齐，不改玩法数据语义。
 *  断链（某版本无迁移条目）返回 null，由 loadSnapshot 的内联兼容逻辑兜底。
 */
import { SAVE_SCHEMA_VERSION } from './save-manager.js';

export interface SnapshotMigration {
  from: number;
  to: number;
  apply: (snap: Record<string, unknown>) => Record<string, unknown>;
}

/** 内建迁移表（按版本顺序；新增 schema 版本时在此追加一条） */
export const SNAPSHOT_MIGRATIONS: readonly SnapshotMigration[] = [
  {
    // v1 → v2：新增 @call 调用栈字段；旧档补空栈
    from: 1,
    to: 2,
    apply: (snap) => (Array.isArray(snap['callStack']) ? snap : { ...snap, callStack: [] }),
  },
  {
    // v2 → v3：SavePosition 新增 sceneHash（写档侧生成）；旧档体无需补齐，仅升版本号
    from: 2,
    to: 3,
    apply: (snap) => snap,
  },
];

/**
 * 把旧版本存档迁移到目标版本（缺省当前版本）。
 *  - 版本 >= target：返回 null（无需迁移）
 *  - 迁移成功：返回新快照对象（meta.schemaVersion 升到 target）
 *  - 断链：返回 null，调用方回退兼容加载
 *  无版本号存档（schemaVersion 缺失）按 v1 对待。
 */
export function migrateSnapshot(raw: unknown, target: number = SAVE_SCHEMA_VERSION): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  const meta = typeof src['meta'] === 'object' && src['meta'] !== null
    ? src['meta'] as Record<string, unknown>
    : {};
  const rawVersion = typeof meta['schemaVersion'] === 'number' ? meta['schemaVersion'] : 1;
  const version = Math.max(1, rawVersion);
  if (version >= target) return null;

  let out = src;
  let v = version;
  while (v < target) {
    const step = SNAPSHOT_MIGRATIONS.find((m) => m.from === v);
    if (step === undefined) return null; // 断链：无迁移路径
    out = step.apply(out);
    v = step.to;
  }

  const outMeta: Record<string, unknown> = typeof out['meta'] === 'object' && out['meta'] !== null
    ? { ...(out['meta'] as Record<string, unknown>) }
    : {};
  outMeta['schemaVersion'] = target;
  return { ...out, meta: outMeta };
}
