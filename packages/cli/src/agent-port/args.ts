import {
  AUTHORING_CONTRACT_VERSION,
  AuthoringOperationError,
  type AutonomyPolicy,
} from '@surdet/authoring';

export interface AgentPortOptions {
  projectRoot: string;
  policy: AutonomyPolicy;
  resumeChangeId?: string;
  requestedContractVersion?: string;
}

function valueAfter(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--') || value.length === 0) {
    throw new AuthoringOperationError('INVALID_REQUEST', `${flag} 需要非空参数值`);
  }
  return value;
}

function policy(value: string): AutonomyPolicy {
  if (value === 'observe' || value === 'stage' || value === 'apply') return value;
  throw new AuthoringOperationError('INVALID_REQUEST', `不支持的 Agent Port policy：${value}`);
}

export function parseAgentPortArgs(args: readonly string[]): AgentPortOptions {
  let projectRoot: string | undefined;
  let selectedPolicy: AutonomyPolicy | undefined;
  let resumeChangeId: string | undefined;
  let requestedContractVersion: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === '--project') {
      if (projectRoot !== undefined) throw new AuthoringOperationError('INVALID_REQUEST', '--project 只能出现一次');
      projectRoot = valueAfter(args, index, flag);
      index += 1;
    } else if (flag === '--policy') {
      if (selectedPolicy !== undefined) throw new AuthoringOperationError('INVALID_REQUEST', '--policy 只能出现一次');
      selectedPolicy = policy(valueAfter(args, index, flag));
      index += 1;
    } else if (flag === '--resume-change') {
      if (resumeChangeId !== undefined) throw new AuthoringOperationError('INVALID_REQUEST', '--resume-change 只能出现一次');
      resumeChangeId = valueAfter(args, index, flag);
      index += 1;
    } else if (flag === '--contract-version') {
      if (requestedContractVersion !== undefined) throw new AuthoringOperationError('INVALID_REQUEST', '--contract-version 只能出现一次');
      requestedContractVersion = valueAfter(args, index, flag);
      index += 1;
    } else {
      throw new AuthoringOperationError('INVALID_REQUEST', `不支持的 Agent Port 参数：${flag}`);
    }
  }

  if (projectRoot === undefined || selectedPolicy === undefined) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'Agent Port 必须显式指定 --project 与 --policy');
  }
  if (requestedContractVersion !== undefined && requestedContractVersion !== AUTHORING_CONTRACT_VERSION) {
    throw new AuthoringOperationError('CONTRACT_VERSION_UNSUPPORTED', `不支持的 authoring contract version：${requestedContractVersion}`);
  }
  return {
    projectRoot,
    policy: selectedPolicy,
    ...(resumeChangeId === undefined ? {} : { resumeChangeId }),
    ...(requestedContractVersion === undefined ? {} : { requestedContractVersion }),
  };
}
