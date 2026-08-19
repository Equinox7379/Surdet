import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertValidSnapshot, type SaveSnapshot, type SaveSlotMeta } from '@surdet/core';

/**
 * 桌面存档存储：按槽位写入 userData/saves/<canonical 词干>.json。
 * 纯 fs 实现，与 Electron 解耦，可脱离 electron 单测（IPC 只负责转发）。
 * 另维护 index.json 元信息索引：列表界面取槽位 meta 无需全量读取/解析每个存档体。
 *
 * A5（槽位文件名碰撞，PROVEN/HIGH）修复：
 * - 逻辑槽位身份 = 任意 JS 字符串（snapshot.meta.id 是唯一权威语义来源）；
 * - 物理存储身份 = canonicalSlotStem 规范编码：确定性、对 JS 字符串单射、Windows 安全，
 *   且与全部 legacy 编码输出命名空间结构性不相交（证明见 CANONICAL_SLOT_PREFIX）；
 * - legacy 编码（L1=sanitizeSlot，L0=更旧一层）仅用于存量存档懒兼容：读回退、
 *   写/删时按所有权验证清理。文件名匹配不转移所有权——一切 legacy 候选必须
 *   以 snapshot.meta.id === 请求槽位 验证，不匹配即大声失败，绝不把他人存档当作请求槽位返回。
 */
/** 单个存档大小上限（字节）：防渲染进程写入超大 JSON */
export const MAX_SAVE_BYTES = 10 * 1024 * 1024;

/** 元信息索引文件名（saves 目录内，不作为存档槽位） */
const INDEX_FILE = 'index.json';

/** 【legacy L1 编码——仅为定位 A5 修复前的存量存档保留，新写入不再使用】
 *  单遍替换：转义符自身 _ → _u，其余不安全字符 → _xHH（变长十六进制）。
 *  非单射：'存'(U+5B58) 与 '[58' 都编码为 '_x5b58'（A5 缺陷，测试永久钉死）。
 *  输出字母表 ⊆ [A-Za-z0-9_-]，永不含 '~'——canonical/legacy 命名空间
 *  结构性不相交证明的一半（见 CANONICAL_SLOT_PREFIX；全 65,536 码元机械 oracle 在测试内）。 */
export function sanitizeSlot(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9-]/g, (c) =>
    c === '_' ? '_u' : `_x${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

/** 【legacy L0 编码——更旧一层：不安全字符 → _，下划线保留；仅为读回退/清理定位保留】
 *  输出字母表 ⊆ [A-Za-z0-9_-]，同样永不含 '~'。 */
function legacyL0Stem(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** A5 canonical 存储身份命名空间前缀（版本化）。
 *  结构性不相交证明（CANONICAL_LEGACY_NAMESPACE_DISJOINT = YES）：
 *  1) 每个 canonical 词干都以 '~sv1' 开头，必含 '~'；
 *  2) legacy L1/L0 都是逐码元替换后拼接，单码元输出字母表 ⊆ [A-Za-z0-9_-]
 *     （测试对全部 65,536 个 UTF-16 码元机械验证），故任意长度 legacy 输出不可能含 '~'；
 *  3) 因此 RANGE(canonicalSlotStem) ∩ RANGE(L1 ∪ L0) = ∅。
 *  '~' 是 Windows 合法文件名字符，无位置限制。 */
export const CANONICAL_SLOT_PREFIX = '~sv1';

/** A5 canonical 槽位存储身份：确定性、对任意 JS 字符串单射、Windows 安全。
 *  文法：前缀 '~sv1' + 单遍 token 流——
 *  - 字面量字母表 [a-z0-9_-] 直出（普通安全 ASCII 逻辑 ID 仅增长一个前缀的长度）；
 *  - 大写字母与其余全部 UTF-16 码元 → '~' + 恰好 4 位小写十六进制（定宽、无歧义边界；
 *    大写不直出：NTFS 大小写不敏感，直出大小写会产生物理别名）；
 *  - 从左到右解析唯一（字面量 1 字符 / 转义定长 5 字符），decodeCanonicalSlotStem
 *    是严格逆映射 → 编码单射。
 *  其他性质：不做 Unicode 归一化（NFC/NFD、孤立代理、嵌入 NUL 等不同 JS 字符串保持
 *  不同物理身份）；词干恒以 '~sv1' 开头 → 不可能等于 Windows 保留设备名
 *  （CON/NUL/COM1…）；字面量不含空格与 '.'、转义以十六进制数字收尾 → 无尾随空格/点。 */
export function canonicalSlotStem(slot: string): string {
  let out = CANONICAL_SLOT_PREFIX;
  for (let i = 0; i < slot.length; i += 1) {
    const unit = slot.charCodeAt(i);
    if (
      (unit >= 0x30 && unit <= 0x39) || // 0-9
      (unit >= 0x61 && unit <= 0x7a) || // a-z
      unit === 0x2d || // -
      unit === 0x5f // _
    ) {
      out += slot.charAt(i);
    } else {
      out += `~${unit.toString(16).padStart(4, '0')}`;
    }
  }
  return out;
}

/** canonicalSlotStem 的严格逆映射（回归 oracle 与诊断用）；非法编码抛错。 */
export function decodeCanonicalSlotStem(stem: string): string {
  if (!stem.startsWith(CANONICAL_SLOT_PREFIX)) {
    throw new Error(`不是 canonical 槽位词干（缺少 '${CANONICAL_SLOT_PREFIX}' 前缀）：${stem}`);
  }
  const body = stem.slice(CANONICAL_SLOT_PREFIX.length);
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body.charAt(i);
    if (ch === '~') {
      const hex = body.slice(i + 1, i + 5);
      if (hex.length !== 4 || !/^[0-9a-f]{4}$/.test(hex)) {
        throw new Error(`canonical 槽位词干含非法转义：${stem}`);
      }
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 5;
    } else if (/[0-9a-z_-]/.test(ch)) {
      out += ch;
      i += 1;
    } else {
      throw new Error(`canonical 槽位词干含非法字面量：${stem}`);
    }
  }
  return out;
}

export class FileSaveStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  #canonicalFileFor(slot: string): string {
    return path.join(this.dir, `${canonicalSlotStem(slot)}.json`);
  }

  private indexPath(): string {
    return path.join(this.dir, INDEX_FILE);
  }

  /** 全部 legacy 候选物理文件（L1 先于 L0；主档与 .bak），路径去重。
   *  文件名只是候选位置——内容可能属于别的逻辑槽位（历史碰撞），
   *  读取/删除前必须以 snapshot.meta.id 独立验证所有权。 */
  #legacyCandidates(slot: string): string[] {
    const stems = [...new Set([sanitizeSlot(slot), legacyL0Stem(slot)])];
    const out: string[] = [];
    for (const stem of stems) {
      const main = path.join(this.dir, `${stem}.json`);
      out.push(main, `${main}.bak`);
    }
    return out;
  }

  /** 所有权验证：物理文件的逻辑身份只由 snapshot.meta.id 决定；不匹配即大声失败（A5）。 */
  #assertOwnedBy(snapshot: SaveSnapshot, slot: string, file: string): void {
    if (snapshot.meta?.id !== slot) {
      throw new Error(
        `存档文件所有权不匹配：物理文件 ${path.basename(file)} 的逻辑属主是 '${snapshot.meta?.id ?? '<缺失>'}'，不是槽位 '${slot}'`,
      );
    }
  }

  /** 逻辑槽位列表（A5：只暴露 snapshot.meta.id 逻辑身份，绝不暴露物理词干）。 */
  list(): string[] {
    return this.listMeta().map((m) => m.id);
  }

  /** 全部槽位元信息（索引存在时仍读取——损坏必须大声失败，保持原行为）；
   *  物理真值基于磁盘扫描：canonical 文件优先，legacy 文件只补足未暴露的逻辑身份，
   *  同一逻辑身份只出现一次（canonical/索引/legacy 之间按 meta.id 去重）。 */
  listMeta(): SaveSlotMeta[] {
    const index = fs.existsSync(this.indexPath()) ? this.readIndex() : {};
    const metas = new Map<string, SaveSlotMeta>();
    for (const m of Object.values(index)) {
      if (m && typeof m.id === 'string' && !metas.has(m.id)) metas.set(m.id, m);
    }
    const entries = fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && f !== INDEX_FILE && !f.endsWith('.tmp'));
    const canonical = entries.filter((f) => f.startsWith(CANONICAL_SLOT_PREFIX)).sort();
    const legacy = entries.filter((f) => !f.startsWith(CANONICAL_SLOT_PREFIX)).sort();
    for (const f of canonical) {
      const snap = this.#readFile(path.join(this.dir, f)); // 损坏 → 大声失败
      if (snap === null) continue;
      // 状态 3：canonical 物理/逻辑所有权不一致 → 枚举时同样大声失败。
      // 不得把含他人 meta.id 的 canonical(S) 静默重释为该逻辑槽位的合法表示，
      // 否则列表暴露可见但 read 不可达的幻影槽位。
      const owner = decodeCanonicalSlotStem(f.slice(0, -'.json'.length));
      this.#assertOwnedBy(snap, owner, path.join(this.dir, f));
      metas.set(snap.meta.id, snap.meta); // canonical 优先
    }
    for (const f of legacy) {
      const snap = this.#readFile(path.join(this.dir, f));
      if (snap && typeof snap.meta?.id === 'string' && !metas.has(snap.meta.id)) {
        metas.set(snap.meta.id, snap.meta);
      }
    }
    return [...metas.values()];
  }

  /** 列出磁盘上可显式恢复的上一版备份；备份内容损坏时保留原始解析原因。
   *  同一逻辑身份去重；canonical 备份优先于 legacy 备份。 */
  listBackupMeta(): SaveSlotMeta[] {
    const metas = new Map<string, SaveSlotMeta>();
    const baks = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json.bak'));
    const ordered = [
      ...baks.filter((f) => !f.startsWith(CANONICAL_SLOT_PREFIX)).sort(),
      ...baks.filter((f) => f.startsWith(CANONICAL_SLOT_PREFIX)).sort(),
    ];
    for (const name of ordered) {
      const snapshot = this.#readBackupFile(path.join(this.dir, name));
      if (name.startsWith(CANONICAL_SLOT_PREFIX)) {
        // canonical 备份所有权不一致 → 大声失败（不暴露幻影备份）
        const owner = decodeCanonicalSlotStem(name.slice(0, -'.json.bak'.length));
        this.#assertOwnedBy(snapshot, owner, path.join(this.dir, name));
      }
      metas.set(snapshot.meta.id, snapshot.meta);
    }
    return [...metas.values()];
  }

  /**
   * 显式将上一版备份复制为主档。备份先完整读取并校验，校验失败时不触碰主档或索引；
   * 成功后保留 .bak，普通 read 仍只读取主档。
   * A5：恢复目标恒为该槽位的 canonical 主档（不盲目替换 legacy 主档）；
   * 备份必须经 snapshot.meta.id 验证属于该槽位（见 #backupFileFor）。
   */
  restoreBackup(slot: string): void {
    const backupFile = this.#backupFileFor(slot);
    if (backupFile === null) throw new Error(`存档槽位 '${slot}' 没有可恢复备份`);
    const backup = this.#readBackupFile(backupFile);
    const file = this.#canonicalFileFor(slot);
    const mainBefore = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const indexFile = this.indexPath();
    const indexBefore = fs.existsSync(indexFile) ? fs.readFileSync(indexFile) : null;
    const index = this.readIndex();
    const tmp = `${file}.restore.tmp`;
    try {
      fs.copyFileSync(backupFile, tmp);
      fs.renameSync(tmp, file);
      this.#setIndexEntry(index, slot, { ...backup.meta, id: slot });
      this.writeIndex(index);
    } catch (error) {
      try {
        if (mainBefore === null) {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } else {
          fs.writeFileSync(tmp, mainBefore);
          fs.renameSync(tmp, file);
        }
        if (indexBefore === null) {
          if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile);
        } else {
          fs.writeFileSync(`${indexFile}.restore.tmp`, indexBefore);
          fs.renameSync(`${indexFile}.restore.tmp`, indexFile);
        }
      } catch (compensationError) {
        throw new Error(`显式恢复失败且无法可靠恢复原主档/索引：${slot}`, {
          cause: compensationError,
        });
      }
      throw error;
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }

  /** 读取槽位存档（A5 顺序：canonical 权威 → legacy 懒回退，均验证所有权）。
   *  读取 legacy 不重写、不迁移（懒兼容）；主档损坏大声失败，不静默回退 .bak。 */
  read(slot: string): SaveSnapshot | null {
    const canonical = this.#canonicalFileFor(slot);
    if (fs.existsSync(canonical)) {
      const snap = this.#readFile(canonical);
      if (snap !== null) {
        // canonical 命名空间无碰撞，此处仍验证所有权：物理存储身份不是
        // 重命名快照内容的许可（状态 3：他人 meta.id → 大声失败）。
        this.#assertOwnedBy(snap, slot, canonical);
        return snap;
      }
    }
    for (const cand of this.#legacyCandidates(slot)) {
      if (!fs.existsSync(cand)) continue;
      const snap = this.#readFile(cand); // 损坏 → 大声失败（不伪装成空槽位）
      if (snap === null) continue;
      this.#assertOwnedBy(snap, slot, cand); // 文件名巧合不转移所有权
      return snap;
    }
    return null;
  }

  write(slot: string, data: SaveSnapshot): void {
    // 写入期所有权不变量：落盘快照的 meta.id 必须等于槽位，防止种下
    // 物理/逻辑不一致状态（读回时 #assertOwnedBy 会拒绝此类文件）。
    if (data?.meta?.id !== slot) {
      throw new Error(`存档槽位 '${slot}' 数据 meta.id 不匹配（实际 '${String(data?.meta?.id)}'），拒绝写入`);
    }
    let json: string;
    try {
      json = JSON.stringify(data);
    } catch (err) {
      // 循环引用/非 JSON 值：转为清晰错误（否则裸 TypeError 经 IPC 上抛，渲染端难以排查）
      throw new Error(
        `存档槽位 '${slot}' 数据无法序列化（可能含循环引用或非 JSON 值）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_SAVE_BYTES) {
      throw new Error(`存档槽位 '${slot}' 超出大小上限（${MAX_SAVE_BYTES} 字节）`);
    }
    const file = this.#canonicalFileFor(slot);
    const tmp = `${file}.tmp`;
    // 覆盖前备份上一版（.bak）：供玩家通过显式恢复动作取回上一版进度
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    // 原子写：先写临时文件再 rename，崩溃/中断不会留下半截损坏存档
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, file);
    // 索引更新失败也必须向上层报告：写入事务不能把部分成功伪装成成功。
    const index = this.readIndex();
    this.#setIndexEntry(index, slot, { ...data.meta, id: slot });
    this.writeIndex(index);
    // A5 懒迁移收尾：仅清理所有权已验证的 legacy 文件（历史碰撞中属于
    // 其他逻辑槽位的数据保持原样）；新写入恒落 canonical 物理身份。
    this.#cleanupVerifiedLegacy(slot);
  }

  delete(slot: string): void {
    // canonical 主档/备份：该命名空间无碰撞，且 write 期已强制 meta.id === slot，
    // 物理身份即属主身份，直接删除。
    const canonical = this.#canonicalFileFor(slot);
    for (const f of [canonical, `${canonical}.bak`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    // legacy 文件：历史碰撞可能使其内容实际属于别的逻辑槽位，
    // 必须独立验证所有权后才删除（损坏不可证明 → 保留，不误毁）。
    for (const cand of this.#legacyCandidates(slot)) {
      if (!fs.existsSync(cand)) continue;
      let snap: SaveSnapshot | null = null;
      try {
        snap = this.#readFile(cand);
      } catch {
        continue;
      }
      if (snap !== null && snap.meta?.id === slot) fs.unlinkSync(cand);
    }
    // 索引按逻辑槽位身份清理（含旧格式按物理词干键控的陈旧条目）。
    const index = this.readIndex();
    let changed = false;
    for (const key of Object.keys(index)) {
      if (key === slot || index[key]?.id === slot) {
        delete index[key];
        changed = true;
      }
    }
    if (changed) this.writeIndex(index);
  }

  /** 定位槽位的备份文件（A5 所有权语义）：
   *  - canonical 备份存在但内容属主不符 → 大声失败（canonical 命名空间无碰撞，不符即异常）；
   *  - legacy 备份属主不符 → 不是该槽位的备份（历史碰撞别名），继续找下一个候选；
   *  - 备份文件损坏 → 大声失败（保留原行为）。 */
  #backupFileFor(slot: string): string | null {
    const canonical = `${this.#canonicalFileFor(slot)}.bak`;
    if (fs.existsSync(canonical)) {
      const snap = this.#readBackupFile(canonical);
      this.#assertOwnedBy(snap, slot, canonical);
      return canonical;
    }
    for (const cand of this.#legacyCandidates(slot)) {
      if (!cand.endsWith('.bak') || !fs.existsSync(cand)) continue;
      const snap = this.#readBackupFile(cand);
      if (snap.meta?.id === slot) return cand;
    }
    return null;
  }

  #readBackupFile(file: string): SaveSnapshot {
    const snapshot = this.#readFile(file);
    if (snapshot === null) throw new Error(`备份文件不存在：${file}`);
    assertValidSnapshot(snapshot, 'legacy');
    return snapshot;
  }

  /** 读取单个存档文件；仅缺失返回 null，I/O/解析/结构错误全部上抛。 */
  #readFile(file: string): SaveSnapshot | null {
    if (!fs.existsSync(file)) return null;
    try {
      // 读隔离：JSON.parse 每次读盘产出的本就是全新对象图（无共享引用），
      // 直接返回即满足与 MemoryStorage.read 一致的隔离契约，无需二次克隆
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('存档 JSON 顶层必须是对象');
      }
      return parsed as SaveSnapshot;
    } catch (error) {
      throw new Error(`存档文件读取或解析失败：${file}`, { cause: error });
    }
  }

  /** 以逻辑槽位 ID 为键写索引条目；同时清掉任何 meta.id 为该槽位的陈旧条目
   *  （旧格式索引按物理词干键控，升级后按逻辑身份收敛，避免重复暴露）。 */
  #setIndexEntry(index: Record<string, SaveSlotMeta>, slot: string, meta: SaveSlotMeta): void {
    for (const key of Object.keys(index)) {
      if (index[key]?.id === slot) delete index[key];
    }
    index[slot] = meta;
  }

  /** 懒迁移清理：仅删除可读且所有权证明属于该槽位的 legacy 文件（主档与 .bak 独立验证）；
   *  内容属于其他逻辑槽位（历史碰撞别名）→ 保持原样；损坏不可证明 → 保留。 */
  #cleanupVerifiedLegacy(slot: string): void {
    for (const cand of this.#legacyCandidates(slot)) {
      if (!fs.existsSync(cand)) continue;
      let snap: SaveSnapshot | null = null;
      try {
        snap = this.#readFile(cand);
      } catch {
        continue;
      }
      if (snap !== null && snap.meta?.id === slot) fs.unlinkSync(cand);
    }
  }

  /** 读取索引；仅缺失视为空表，损坏或 I/O 错误必须上抛。
   *  返回空原型对象：逻辑槽位 ID 是任意 JS 字符串，在普通对象上赋值 '__proto__'
   *  键会触发 Object.prototype.__proto__ 访问器——条目静默丢失并污染对象原型。
   *  空原型对象上 '__proto__'/'constructor'/'toString' 等键均为普通自有属性，
   *  索引的写入/删除/序列化对任意逻辑键安全。（JSON.parse 以 DefineOwnProperty
   *  落键，本身不触发访问器；此处统一复制到空原型对象供后续操作。） */
  private readIndex(): Record<string, SaveSlotMeta> {
    if (!fs.existsSync(this.indexPath())) {
      return Object.create(null) as Record<string, SaveSlotMeta>;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8')) as Record<string, SaveSlotMeta>;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('存档索引顶层必须是对象');
      }
      const index = Object.create(null) as Record<string, SaveSlotMeta>;
      for (const [key, value] of Object.entries(raw)) index[key] = value;
      return index;
    } catch (error) {
      throw new Error(`存档索引读取或解析失败：${this.indexPath()}`, { cause: error });
    }
  }

  /** 原子写索引 */
  private writeIndex(index: Record<string, SaveSlotMeta>): void {
    const file = this.indexPath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(index));
    fs.renameSync(tmp, file);
  }
}
