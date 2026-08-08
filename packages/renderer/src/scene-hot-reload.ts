import type { CompiledScene } from '@surdet/core';

export interface HotReloadDecision {
  apply: boolean;
  nextPc: number;
  diagnostic?: string;
}

/**
 * 只决定场景替换是否安全，不接触 Vite、文件系统或舞台资源。
 * currentSceneHash 是可选的兼容参数，供宿主在有活动存档定位时报告哈希变化。
 */
export function decideSceneHotReload(
  currentSceneId: string,
  currentPc: number,
  replacement: CompiledScene,
  currentSceneHash?: string,
): HotReloadDecision {
  if (replacement.sceneId !== currentSceneId) {
    return { apply: false, nextPc: currentPc, diagnostic: `热重载场景 ID 不匹配：当前 ${currentSceneId}，收到 ${replacement.sceneId}` };
  }
  const nextPc = Math.max(0, Math.min(currentPc, replacement.instructions.length));
  const diagnostic = currentSceneHash && replacement.sceneHash && currentSceneHash !== replacement.sceneHash
    ? `场景 ${currentSceneId} 源码已变化，PC 已安全限制为 ${nextPc}`
    : nextPc !== currentPc ? `场景 ${currentSceneId} 的 PC 已限制为 ${nextPc}` : undefined;
  return { apply: true, nextPc, ...(diagnostic ? { diagnostic } : {}) };
}
