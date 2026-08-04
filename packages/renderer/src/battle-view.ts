import type { CombatSnapshot } from '@surdet/core';

/**
 * 战斗交互式 UI 视图模型：把 CombatSnapshot 映射为渲染层展示结构。
 * 纯函数、headless 可测；PixiStage.showBattle 负责展示，宿主负责行动结算。
 */

/** 技能按钮展示形态 */
export interface BattleSkillView {
  id: string;
  name: string;
  /** 冷却就绪可使用 */
  ready: boolean;
  /** 剩余冷却回合（未就绪时展示） */
  cooldown: number;
}

/** 单个战斗单位的展示形态 */
export interface BattleUnitView {
  uid: string;
  name: string;
  team: string;
  hp: number;
  maxHp: number;
  /** 血量比例 0..1（血条宽度用） */
  hpRatio: number;
  alive: boolean;
  /** 技能按钮（含冷却状态） */
  skills: BattleSkillView[];
  /** 能否移动（存活 + 有移动力 + 本回合未移动过；是否行动方由 UI 按 actingTeam 判定） */
  canMove: boolean;
}

/** 一场战斗的展示快照 */
export interface BattleView {
  turn: number;
  /** 当前行动阵营 */
  actingTeam: string;
  finished: boolean;
  winner: string | null;
  units: BattleUnitView[];
}

/** 快照 → 视图（宿主每次行动结算后重新调用并 showBattle 刷新）。
 *  skillsConfig 提供技能显示名（缺省用技能 ID）。 */
export function buildBattleView(
  snap: CombatSnapshot,
  skillsConfig: { id: string; name: string }[] = [],
): BattleView {
  return {
    turn: snap.turn,
    actingTeam: snap.actingTeam,
    finished: snap.finished,
    winner: snap.winner,
    units: snap.units.map((u) => ({
      uid: u.uid,
      name: u.name,
      team: u.team,
      hp: u.hp,
      maxHp: u.maxHp,
      hpRatio: u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0,
      alive: u.alive,
      canMove: u.alive && u.move > 0 && !(snap.moved ?? []).includes(u.uid),
      skills: u.skills.map((sid) => {
        const cd = u.cooldowns[sid] ?? 0;
        const def = skillsConfig.find((s) => s.id === sid);
        return { id: sid, name: def?.name ?? sid, ready: cd <= 0, cooldown: cd };
      }),
    })),
  };
}
