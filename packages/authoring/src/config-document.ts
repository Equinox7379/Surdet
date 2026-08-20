import { AuthoringOperationError } from './change-session.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProjectConfigDocument(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new AuthoringOperationError(
      'PROJECT_INVALID',
      `game.config.json 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json 必须是 JSON 对象');
  }
  return parsed;
}
