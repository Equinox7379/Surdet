import { isContentHistoryPath, normalizeProjectPath, type ContentHistoryFileDiff } from '@surdet/authoring';
import { state } from './state.js';
import { sceneTextSha256 } from './project-io.js';
import { setSceneText } from './history.js';
import { pushTimelineSnapshot } from './timeline-history.js';
import { parseTimelineText } from './timeline-model.js';
import { configSourcePath, type ConfigSourceName, parseConfigSource } from './config-source.js';
import { restoreConfigSourceDraft } from './panels/config.js';
import { editorWorkspaceStatus } from './editor-workspace.js';

/** Prepare without mutation; caller checks its workspace again before applying. */
export async function prepareHistoryFileDraft(file: ContentHistoryFileDiff): Promise<() => void> {
  const path = normalizeProjectPath(file.path);
  if (!isContentHistoryPath(path) || typeof file.historicalText !== 'string' || file.currentText === undefined) throw new Error('请重新读取这个历史文件的完整差异');
  const text = file.historicalText;
  if (await sceneTextSha256(text) !== file.historicalSha256
    || (file.currentText === null ? null : await sceneTextSha256(file.currentText)) !== file.currentSha256) throw new Error('历史差异正文不完整，请重新读取');
  const baseline = editorWorkspaceStatus().baseline;
  if (baseline === null || (baseline.files.find(item => item.path === path)?.sha256 ?? null) !== file.currentSha256) {
    throw new Error('当前项目基线已变化，请先同步项目再恢复');
  }
  if (path.startsWith('content/scenario/')) {
    const relative = path.slice('content/scenario/'.length);
    const key = relative.replace(/\.gal$/i, '');
    const entry = state.scenes.get(key);
    if ((entry?.text ?? null) !== file.currentText) throw new Error('剧本已经修改，请先处理当前草稿');
    return () => {
      if (entry) setSceneText(key, text);
      else state.scenes.set(key, { id: key.split('/').at(-1)!, file: relative, text,
        eol: text.includes('\r\n') ? '\r\n' : '\n', dirty: true, handle: null, pendingCreateOperationId: crypto.randomUUID() });
      state.current = key;
      state.mainTab = 'editor';
    };
  }
  if (path.startsWith('content/timelines/')) {
    const relative = path.slice('content/timelines/'.length);
    const id = relative.split('/').at(-1)!.replace(/\.json$/i, '');
    const parsed = parseTimelineText(text);
    if (parsed.definition === null || parsed.definition.id !== id) throw new Error(`历史时间轴无效：${parsed.issues.join('；') || '时间轴标识与文件名不符'}`);
    const entry = state.timelines.find(item => item.file === relative || item.file === path);
    if ((entry?.text ?? null) !== file.currentText) throw new Error('时间轴已经修改，请先处理当前草稿');
    if (!entry && state.timelines.some(item => item.id === id)) throw new Error('当前已有同名时间轴，请先处理同名冲突');
    return () => {
      if (entry) {
        pushTimelineSnapshot(entry.id, entry.text);
        entry.text = text; entry.dirty = true;
      } else state.timelines.push({ id, file: relative, text, eol: text.includes('\r\n') ? '\r\n' : '\n', dirty: true, handle: null });
      state.currentTimeline = id; state.currentTimelineCue = null; state.mainTab = 'timeline';
    };
  }
  const name = (Object.keys(state.handles) as ConfigSourceName[]).find(name => configSourcePath(name) === path);
  if (name === undefined) throw new Error('这个配置暂不支持编辑器恢复');
  parseConfigSource(name, text);
  return () => {
    restoreConfigSourceDraft(name, text, file.currentText!);
    state.mainTab = 'config';
  };
}
