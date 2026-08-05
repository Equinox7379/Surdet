/**
 * 制作统计（M6 E5-2）：从场景文本推导制作进度指标（纯函数，可测）。
 * 制作人向投资人/发行报进度用：字数/台词数/选择肢/结局数/预估通关时长。
 */
import { parseScript } from './model.js';

export interface SceneStat {
  id: string;
  /** 台词+旁白总字数（不含指令行） */
  chars: number;
  /** 有说话人的台词行数 */
  dialogueLines: number;
  /** 选择肢选项数 */
  choices: number;
}

export interface ProjectStats {
  scenes: number;
  totalChars: number;
  dialogueLines: number;
  narrationLines: number;
  choices: number;
  /** @clear 出现次数（结局数） */
  endings: number;
  /** @unlock_cg 去重数 */
  cgUnlocks: number;
  /** @wait 累计毫秒 */
  waitMs: number;
  /** 预估通关分钟数（字数/默认文本速度 + wait + 转场估算） */
  estMinutes: number;
  perScene: SceneStat[];
}

/** 预估用的缺省阅读速度（字/秒，与渲染层缺省 textSpeedCps 同口径） */
const DEFAULT_CPS = 30;
/** 转场类指令的估算耗时（fadein/fadeout/wipe/flash 各按 400ms 估） */
const TRANSITION_MS = 400;

export function computeProjectStats(scenes: Iterable<{ id: string; text: string }>): ProjectStats {
  const stats: ProjectStats = {
    scenes: 0, totalChars: 0, dialogueLines: 0, narrationLines: 0, choices: 0,
    endings: 0, cgUnlocks: 0, waitMs: 0, estMinutes: 0, perScene: [],
  };
  const cgIds = new Set<string>();
  let transitionCount = 0;

  for (const sc of scenes) {
    const per: SceneStat = { id: sc.id, chars: 0, dialogueLines: 0, choices: 0 };
    for (const line of parseScript(sc.text)) {
      if (line.kind === 'text') {
        const t = line as { speaker: string; value: string };
        per.chars += t.value.length;
        if (t.speaker.length > 0) { per.dialogueLines++; stats.dialogueLines++; }
        else stats.narrationLines++;
      } else if (line.kind === 'choice-option') {
        per.choices++;
        stats.choices++;
      } else if (line.kind === 'instr') {
        const ins = line as { name: string; raw: string };
        if (ins.name === 'clear') stats.endings++;
        if (ins.name === 'unlock_cg') {
          const id = ins.raw.trim().split(/\s+/)[1];
          if (id) cgIds.add(id);
        }
        if (ins.name === 'wait') {
          const ms = Number(ins.raw.trim().split(/\s+/)[1]);
          if (Number.isFinite(ms) && ms > 0) stats.waitMs += ms;
        }
        if (['fadein', 'fadeout', 'wipe', 'flash'].includes(ins.name)) transitionCount++;
      }
    }
    stats.totalChars += per.chars;
    stats.perScene.push(per);
    stats.scenes++;
  }
  stats.cgUnlocks = cgIds.size;
  const totalMs = (stats.totalChars / DEFAULT_CPS) * 1000 + stats.waitMs + transitionCount * TRANSITION_MS;
  stats.estMinutes = Math.round((totalMs / 60000) * 10) / 10;
  return stats;
}
