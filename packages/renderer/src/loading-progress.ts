export type AssetPriority = 'critical' | 'scene' | 'background';

export interface AssetLoadJob {
  id: string;
  priority: AssetPriority;
  load(): Promise<void>;
}

export interface LoadingProgress {
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  done: boolean;
}

const ORDER: Record<AssetPriority, number> = {
  critical: 0,
  scene: 1,
  background: 2,
};

export class AssetLoadQueue {
  readonly concurrency: number;

  constructor(concurrency = 4) {
    this.concurrency = Math.max(1, Math.min(8, Math.floor(concurrency)));
  }

  async run(
    jobs: readonly AssetLoadJob[],
    onProgress?: (progress: LoadingProgress) => void,
  ): Promise<LoadingProgress> {
    const ids = new Set<string>();
    for (const job of jobs) {
      if (!job.id.trim() || ids.has(job.id)) {
        throw new Error(`duplicate or empty asset job '${job.id}'`);
      }
      ids.add(job.id);
    }

    const pending = jobs.map((job, index) => ({ job, index }))
      .sort((a, b) => ORDER[a.job.priority] - ORDER[b.job.priority] || a.index - b.index);
    let completed = 0;
    let failed = 0;
    let cursor = 0;
    const emit = (current: string | null, done = false): LoadingProgress => {
      const snapshot = { total: jobs.length, completed, failed, current, done };
      onProgress?.({ ...snapshot });
      return snapshot;
    };

    emit(null, jobs.length === 0);
    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const current = pending[cursor++]!.job;
        emit(current.id);
        try {
          await current.load();
          completed += 1;
        } catch {
          failed += 1;
        }
        emit(current.id);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, pending.length) }, () => worker()),
    );
    return emit(null, true);
  }
}
