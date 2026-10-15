/**
 * 制作统计（M6 E5-2）：从场景文本推导制作进度指标（纯函数，可测）。
 * 制作人向投资人/发行报进度用：字数/台词数/选择肢/结局数/预估通关时长。
 */
import { parseScript } from './model.js';
import { compileScene, computeProjectStats as computeCoreProjectStats, inlineTextLength } from '@surdet/core';

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

/**
 * Visible characters of one scene's dialogue and narration, the same measure as `totalChars`
 * (no tags, commands or variable names). It reads rows without compiling, so a scene that
 * does not compile yet still gets a count.
 */
export function sceneTextCharacters(text: string): number {
  return parseScript(text).reduce((sum, line) => sum + (line.kind === 'text' ? inlineTextLength(line.value) : 0), 0);
}

export function computeProjectStats(scenes: Iterable<{ id: string; text: string }>): ProjectStats {
  const materialized = [...scenes];
  const compiled = materialized.map((scene) => compileScene(scene.text, `${scene.id}.gal`, scene.id));
  const core = computeCoreProjectStats({
    scenes: compiled,
    entryScene: materialized[0]?.id ?? '',
    sourceTextByScene: Object.fromEntries(materialized.map((scene) => [scene.id, scene.text])),
  });
  const stats: ProjectStats = {
    scenes: core.sceneCount,
    totalChars: core.totalCharacters,
    dialogueLines: Object.values(core.speakerLines).reduce((sum, count) => sum + count, 0),
    narrationLines: core.totalTextLines - Object.values(core.speakerLines).reduce((sum, count) => sum + count, 0),
    choices: Object.values(core.perScene).reduce((sum, scene) => sum + scene.choiceOptionCount, 0),
    endings: core.endingCount,
    cgUnlocks: 0, waitMs: 0, estMinutes: 0, perScene: [],
  };
  const cgIds = new Set<string>();
  for (const scene of compiled) {
    for (const instruction of scene.instructions) {
      if (instruction.op !== 'instr' || instruction.name !== 'unlock_cg' || instruction.args[0] === undefined) continue;
      const id = instruction.args[0];
      if (id.trim()) cgIds.add(id);
    }
  }
  let transitionCount = 0;

  for (const sc of materialized) {
    const coreScene = core.perScene[sc.id];
    const per: SceneStat = {
      id: sc.id,
      chars: coreScene?.totalCharacters ?? 0,
      dialogueLines: Object.values(coreScene?.speakerLines ?? {}).reduce((sum, count) => sum + count, 0),
      choices: coreScene?.choiceOptionCount ?? 0,
    };
    for (const line of parseScript(sc.text)) {
      if (line.kind === 'instr') {
        const ins = line as { name: string; raw: string };
        if (ins.name === 'wait') {
          const ms = Number(ins.raw.trim().split(/\s+/)[1]);
          if (Number.isFinite(ms) && ms > 0) stats.waitMs += ms;
        }
        if (['fadein', 'fadeout', 'wipe', 'flash'].includes(ins.name)) transitionCount++;
      }
    }
    stats.perScene.push(per);
  }
  stats.cgUnlocks = cgIds.size;
  const totalMs = (stats.totalChars / DEFAULT_CPS) * 1000 + stats.waitMs + transitionCount * TRANSITION_MS;
  stats.estMinutes = Math.round((totalMs / 60000) * 10) / 10;
  return stats;
}
