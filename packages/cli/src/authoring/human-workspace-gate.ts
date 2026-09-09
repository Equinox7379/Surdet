import {
  AuthoringOperationError,
  humanWorkspaceCommitBlock,
  type HumanWorkspaceSummary,
} from '@surdet/authoring';
import type { HumanWorkspaceStore } from './human-workspace-store.js';

function dirtyError(summary: HumanWorkspaceSummary): AuthoringOperationError {
  return new AuthoringOperationError(
    'HUMAN_WORKSPACE_DIRTY',
    '绑定同一项目的人类 Editor 存在未保存修改，未执行项目提交',
    {
      humanWorkspace: summary,
      projectMutationOccurred: false,
      changeStatusAdvanced: false,
    },
  );
}

function busyError(summary: HumanWorkspaceSummary): AuthoringOperationError {
  return new AuthoringOperationError(
    'HUMAN_WORKSPACE_BUSY',
    '绑定同一项目的人类 Editor 正在保存、切换或执行受控写入，未执行项目提交',
    {
      humanWorkspace: summary,
      retryAfterMs: summary.retryAfterMs,
      projectMutationOccurred: false,
      changeStatusAdvanced: false,
    },
  );
}

function corruptError(summary: HumanWorkspaceSummary): AuthoringOperationError {
  return new AuthoringOperationError(
    'HUMAN_WORKSPACE_STATE_CORRUPT',
    '绑定同一项目的人类工作区状态无法安全确认，未执行项目提交',
    {
      humanWorkspace: summary,
      manualRecoveryRequired: true,
      projectMutationOccurred: false,
      changeStatusAdvanced: false,
    },
  );
}

export async function assertHumanWorkspaceAllowsAgentCommit(
  store: Pick<HumanWorkspaceStore, 'inspect'>,
  projectRootIdentity: string,
): Promise<HumanWorkspaceSummary> {
  const inspected = await store.inspect(projectRootIdentity);
  const blocked = humanWorkspaceCommitBlock(inspected.summary);
  if (blocked === null) return inspected.summary;
  if (blocked.code === 'HUMAN_WORKSPACE_DIRTY') throw dirtyError(blocked.summary);
  if (blocked.code === 'HUMAN_WORKSPACE_BUSY') throw busyError(blocked.summary);
  throw corruptError(blocked.summary);
}
