import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthoringOperationError } from '@surdet/authoring';
import { NodeLocalLeaseManager, type LeaseHandle } from '../authoring/node-local-lease.js';

interface ActiveMutationLease {
  projectRootIdentity: string;
  handle: LeaseHandle;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

/**
 * Request-scoped project mutation lease for the bound Editor authority.
 *
 * The authority service and browser binding may stay alive for hours. Only a
 * callback that can mutate the project root enters run(), so merely opening an
 * Editor never blocks an Agent Port commit.
 */
export class ProjectMutationLeaseContext {
  private readonly storage = new AsyncLocalStorage<ActiveMutationLease>();

  private constructor(
    readonly projectRootIdentity: string,
    private readonly manager: NodeLocalLeaseManager,
  ) {}

  static async open(
    projectRoot: string,
    manager = new NodeLocalLeaseManager(),
  ): Promise<ProjectMutationLeaseContext> {
    const projectRootIdentity = await fs.realpath(projectRoot);
    return new ProjectMutationLeaseContext(projectRootIdentity, manager);
  }

  async run<T>(callback: (lease: LeaseHandle) => Promise<T>): Promise<T> {
    const active = this.storage.getStore();
    if (active !== undefined) {
      if (!samePath(active.projectRootIdentity, this.projectRootIdentity)) {
        throw new AuthoringOperationError(
          'PROJECT_IDENTITY_MISMATCH',
          '嵌套项目写入 lease 指向另一项目',
        );
      }
      await this.manager.assertOwned(active.handle);
      return callback(active.handle);
    }
    return this.manager.withProjectLease(this.projectRootIdentity, async (handle) => (
      this.storage.run({ projectRootIdentity: this.projectRootIdentity, handle }, () => callback(handle))
    ));
  }

  async assertHeld(): Promise<void> {
    const active = this.storage.getStore();
    if (active === undefined || !samePath(active.projectRootIdentity, this.projectRootIdentity)) {
      throw new AuthoringOperationError(
        'PROJECT_BUSY',
        '项目 mutation authority 未持有当前写入 lease',
      );
    }
    await this.manager.assertOwned(active.handle);
  }

  async runWithLease<T>(handle: LeaseHandle, callback: () => Promise<T>): Promise<T> {
    if (handle.scope !== 'project' || !samePath(handle.resourceId, this.projectRootIdentity)) {
      throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH', '保存 lease 指向另一项目');
    }
    await this.manager.assertOwned(handle);
    return this.storage.run({ projectRootIdentity: this.projectRootIdentity, handle }, callback);
  }

  inspect() {
    return this.manager.inspect('project', this.projectRootIdentity);
  }
}
