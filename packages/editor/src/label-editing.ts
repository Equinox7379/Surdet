import { editProjectLabel, renameLabelDefinition, rewriteLabelReferences } from '@surdet/authoring';
import { state } from './state.js';
import { histories, setSceneText } from './history.js';
import { assertConfigSourcesReadable } from './config-source.js';
import { prepareSceneLabelConfigRename, readProjectSourceText, runProjectWriteOperation, sceneProjectPath, sceneTextSha256 } from './project-io.js';
import { parseScript } from './model.js';

let prepareRows: (sceneId: string, from: string, to?: string) => () => void = () => () => {};
let onEdited: () => void = () => {};
export function bindLabelEditingHooks(hooks: { prepareConfig: typeof prepareRows; onEdited: () => void }): void {
  prepareRows = hooks.prepareConfig; onEdited = hooks.onEdited;
}

export async function editSceneLabel(key: string, index: number, expectedRaw: string, to?: string): Promise<void> {
  const scene = state.scenes.get(key), project = state.dirHandle;
  const check = (): string => {
    if (!scene || state.scenes.get(key) !== scene || state.dirHandle !== project || state.projectLoading || state.projectWriteLock !== null || state.reviewPreviewReadOnly) throw new Error('项目当前不可编辑，请重新打开标签后再试');
    if (state.pendingSceneCommit || state.pendingSceneDeletes.length > 0 || state.pendingSceneConfigRenames.some(rename => rename.labelScene === undefined)) throw new Error('请先保存场景改名、移动或待删除内容，再修改标签');
    if (state.pendingSceneConfigRenames.length >= 100) throw new Error('请先保存已有标签改名，再继续');
    const line = parseScript(scene.text)[index];
    if (line?.kind !== 'label' || line.raw !== expectedRaw) throw new Error('标签或正文位置已变化，请重新选择后再试');
    if (to === undefined && state.pendingSceneConfigRenames.some(rename => rename.labelScene === scene.id && (rename.from === line.name || rename.to === line.name))) throw new Error('请先保存这个标签的改名，再删除标签');
    if (to !== undefined && project !== null && (!scene.handle || !scene.persistedSha256)) throw new Error('请先保存新建场景，再同步改名标签');
    assertConfigSourcesReadable(['gallery']); return line.name;
  };
  check();
  await runProjectWriteOperation(async () => {
    const from = check();
    if (to !== undefined && project !== null) {
      // The save/recovery authority replays identities from disk, not from the
      // current dirty text. Prove this rename can join that same chain first.
      const path = sceneProjectPath(scene!.file);
      let baseline = await readProjectSourceText(scene!.handle!);
      if (await sceneTextSha256(baseline) !== scene!.persistedSha256) throw new Error('场景原文件已在外部变化，请先处理来源冲突，再修改标签');
      check();
      for (const rename of state.pendingSceneConfigRenames) if (rename.labelScene === scene!.id) {
        baseline = editProjectLabel({ [path]: baseline }, scene!.id, rename.from, rename.to).workingFiles[path]!;
      }
      if (!parseScript(baseline).some(line => line.kind === 'label' && line.name === from)) throw new Error('请先保存当前草稿中的新标签，再同步改名标签');
      editProjectLabel({ [path]: baseline }, scene!.id, from, to);
    }
    const applyConfig = to === undefined ? () => {} : await prepareSceneLabelConfigRename(scene!.id, from, to);
    check();
    const applyRows = prepareRows(scene!.id, from, to);
    const files: Record<string, string> = {};
    for (const entry of state.scenes.values()) files[sceneProjectPath(entry.file)] = entry.text;
    if (state.configFiles.gallery !== null) files['content/config/gallery.json'] = JSON.stringify(state.configFiles.gallery);
    const result = editProjectLabel(files, scene!.id, from, to);
    if (to === undefined) { setSceneText(key, result.workingFiles[sceneProjectPath(scene!.file)]!); onEdited(); return; }
    const historyEdits = new Map<string, { past: string[]; future: string[] }>();
    for (const [historyKey, history] of histories) {
      const entry = state.scenes.get(historyKey); if (!entry) continue;
      const rewrite = (source: string): string => {
        const next = rewriteLabelReferences(source, sceneProjectPath(entry.file), entry.id, scene!.id, from, to, []);
        return historyKey === key ? renameLabelDefinition(next, from, to) : next;
      };
      try { historyEdits.set(historyKey, { past: history.past.map(rewrite), future: history.future.map(rewrite) }); }
      catch (error) { throw new Error(`场景 ${entry.id} 的撤销历史无法安全改名；请先修正并保存、重开项目后再试。${error instanceof Error ? error.message : String(error)}`); }
    }
    applyConfig(); applyRows();
    for (const entry of state.scenes.values()) {
      const text = result.workingFiles[sceneProjectPath(entry.file)]!;
      if (text !== entry.text) { entry.text = text; entry.dirty = true; }
    }
    for (const [historyKey, edited] of historyEdits) Object.assign(histories.get(historyKey)!, edited);
    onEdited();
  });
}
