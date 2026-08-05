/**
 * 跨场景搜索/替换（M6 E5-1）：全文搜索（正则可选），替换走 history 可撤销，
 * 替换后由调用方重新调度校验。
 */

export interface SceneText {
  /** 场景 Map key（相对路径） */
  key: string;
  /** 场景 ID（basename） */
  id: string;
  text: string;
}

export interface SearchResult {
  sceneKey: string;
  sceneId: string;
  /** 0 基行号（块编辑 data-line 同口径） */
  line: number;
  text: string;
}

/** 构造匹配器（非法正则返回 null，由 UI 提示） */
export function buildMatcher(query: string, useRegex: boolean): RegExp | null {
  try {
    return useRegex ? new RegExp(query, 'g') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  } catch {
    return null;
  }
}

/** 跨场景搜索：逐行匹配原始行文本；上限 maxResults 条（防止超大结果拖垮 UI）。
 *  匹配器循环外一次构造（M6 审阅轮 Minor 2）；g 标志的 lastIndex 逐行重置防跨行残留 */
export function searchScenes(scenes: Iterable<SceneText>, query: string, useRegex: boolean, maxResults = 500): SearchResult[] {
  if (query.length === 0) return [];
  const re = buildMatcher(query, useRegex);
  if (!re) return [];
  const results: SearchResult[] = [];
  for (const sc of scenes) {
    const lines = sc.text.split(/\r?\n/);
    lines.forEach((text, i) => {
      if (results.length >= maxResults) return;
      re.lastIndex = 0;
      if (re.test(text)) {
        results.push({ sceneKey: sc.key, sceneId: sc.id, line: i, text });
      }
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

/** 单场景全文替换：返回替换后的文本与替换次数（count=0 时调用方不应写入） */
export function replaceInSceneText(text: string, query: string, replacement: string, useRegex: boolean): { text: string; count: number } | null {
  const re = buildMatcher(query, useRegex);
  if (!re) return null;
  let count = 0;
  const next = text.replace(re, () => { count++; return replacement; });
  return { text: next, count };
}
