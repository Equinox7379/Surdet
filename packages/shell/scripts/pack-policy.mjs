import path from 'node:path';

/**
 * 打包策略的纯函数边界：目标、模式、加密和 staging 根目录在任何写盘前确定。
 */
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
