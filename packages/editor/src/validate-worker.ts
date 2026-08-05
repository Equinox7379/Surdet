/**
 * 校验 Web Worker（自我迭代 ①b）：全项目校验移出主线程，大型项目编辑不再卡顿。
 * 与主线程同步回退共用同一 validateProject（core scene-lint），行为完全一致；
 * 结果按 seq 对齐，过期结果直接丢弃（校验永远以最新编辑快照为准）。
 */
import { validateProject } from './validate.js';
import type { SceneSource, ProjectConfig } from './validate.js';

interface ValidateRequest {
  seq: number;
  sources: SceneSource[];
  entryScene?: string;
  config?: ProjectConfig;
}

interface SceneEdge {
  from: string;
  to: string;
  kind: 'jump' | 'call';
}

self.onmessage = (e: MessageEvent<ValidateRequest>) => {
  const { seq, sources, entryScene, config } = e.data;
  try {
    const result = validateProject(sources, entryScene, config);
    // 引用图谱在 Worker 内算好，只回传纯数据（structuredClone 友好）
    const edges: SceneEdge[] = [];
    for (const [sceneId, scene] of result.scenes) {
      for (const instr of scene.instructions) {
        if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
          const target = (instr as { target: string }).target;
          edges.push({ from: sceneId, to: target, kind: instr.op === 'call' ? 'call' : 'jump' });
        }
      }
    }
    // 引用图谱在 Worker 内算好，只回传纯数据（structuredClone 友好）；
    // 编译产物一并回传（E1a：流程图从编译产物提取，不重新解析；Map 可被 structuredClone）
    self.postMessage({ seq, ok: true, issues: result.issues, edges, scenes: result.scenes });
  } catch (err) {
    self.postMessage({ seq, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
