import { AuthoringOperationError } from './change-session.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProjectConfigDocument(text: string, filePath = 'game.config.json'): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new AuthoringOperationError(
      'PROJECT_INVALID',
      `${filePath} 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new AuthoringOperationError('PROJECT_INVALID', `${filePath} 必须是 JSON 对象`);
  }
  return parsed;
}

export function serializeProjectConfigDocument(config: Record<string, unknown>, sourceText: string): string {
  const eol = sourceText.match(/\r\n|\n/)?.[0] ?? '\n';
  return `${sourceText.startsWith('\uFEFF') ? '\uFEFF' : ''}${JSON.stringify(config, null, 2).replace(/\n/g, eol)}${eol}`;
}
