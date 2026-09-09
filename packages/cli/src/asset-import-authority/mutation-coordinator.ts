import type { ProjectMutationLeaseContext } from '../editor-workspace-authority/project-mutation-lease-context.js';

export type AssetProjectMutationOwner = 'asset-import' | 'asset-relocation' | 'scene-lifecycle';

type ReadinessGate = () => void | Promise<void>;

/**
 * One in-process lane for every authority that can alter the current project.
 * Participants keep their own durable state; this class only closes the race
 * between checking the other authority and beginning a new write operation.
 */
export class AssetProjectMutationCoordinator {
  private readonly readiness = new Map<AssetProjectMutationOwner, ReadinessGate>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly defaultLeaseContext?: ProjectMutationLeaseContext) {}

  register(owner: AssetProjectMutationOwner, gate: ReadinessGate): void {
    this.readiness.set(owner, gate);
  }

  async assertOtherReady(owner: AssetProjectMutationOwner): Promise<void> {
    for (const [candidate, gate] of this.readiness) {
      if (candidate !== owner) await gate();
    }
  }

  async assertAllReady(): Promise<void> {
    for (const gate of this.readiness.values()) await gate();
  }

  async run<T>(
    owner: AssetProjectMutationOwner,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tail = tail;
    await previous;
    try {
      const readinessAndWork = async (): Promise<T> => {
        await this.assertOtherReady(owner);
        return work();
      };
      return this.defaultLeaseContext === undefined
        ? await readinessAndWork()
        : await this.defaultLeaseContext.run(() => readinessAndWork());
    } finally {
      release();
      if (this.tail === tail) this.tail = Promise.resolve();
    }
  }
}
