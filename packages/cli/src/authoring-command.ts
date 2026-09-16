import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import {
  AUTHORING_CONTRACT_VERSION,
  createFailureEnvelope,
  createSuccessEnvelope,
  getCapabilityDefinition,
  type AuthoringCapabilityId,
} from '@surdet/authoring';
import { dispatchAuthoringCapability, type InvocationContext } from './authoring/authoring-dispatcher.js';
import { AuthoringService, type ServiceResult } from './authoring/authoring-service.js';
import { authorizeImageSources } from './authoring/agent-image-import-service.js';

interface ParsedArgs {
  project?: string;
  change?: string;
  ref?: string;
  input?: string;
  trace?: string;
  query?: string;
  assetSources?: string[];
  assetImportDataRoot?: string;
  json: boolean;
  debug: boolean;
}

function nextValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 需要参数值`);
  return value;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false, debug: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--json') parsed.json = true;
    else if (arg === '--debug') parsed.debug = true;
    else if (arg === '--project') parsed.project = nextValue(args, index++, arg);
    else if (arg === '--change') parsed.change = nextValue(args, index++, arg);
    else if (arg === '--ref') parsed.ref = nextValue(args, index++, arg);
    else if (arg === '--input') parsed.input = nextValue(args, index++, arg);
    else if (arg === '--trace') parsed.trace = nextValue(args, index++, arg);
    else if (arg === '--query') parsed.query = nextValue(args, index++, arg);
    else if (arg === '--asset-source') (parsed.assetSources ??= []).push(nextValue(args, index++, arg));
    else if (arg === '--asset-import-data-root') parsed.assetImportDataRoot = nextValue(args, index++, arg);
    else throw new Error(`不支持的 authoring 参数：${arg}`);
  }
  return parsed;
}

function readJsonFile(file: string | undefined): unknown {
  if (file === undefined) throw new Error('写操作需要 --input <json-file> 或 --input -');
  const text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
}

function readOptionalJsonFile(file: string | undefined): unknown {
  if (file === undefined) return {};
  return readJsonFile(file);
}

function capabilityFor(command: string, subcommand: string, subsubcommand = ''): AuthoringCapabilityId {
  const capability = subsubcommand.length > 0 ? `${command}.${subcommand}.${subsubcommand}` : `${command}.${subcommand}`;
  try {
    getCapabilityDefinition(capability as AuthoringCapabilityId);
    return capability as AuthoringCapabilityId;
  } catch {
    throw new Error(`未知 authoring 命令：${command} ${subcommand}${subsubcommand.length > 0 ? ` ${subsubcommand}` : ''}`);
  }
}

async function dispatchCli(
  service: AuthoringService,
  capability: AuthoringCapabilityId,
  args: ParsedArgs,
): Promise<{ value: ServiceResult<unknown>; operationId?: string }> {
  if (args.change !== undefined && args.project !== undefined) {
    await service.assertChangeProject(args.change, args.project);
  }
  const context: InvocationContext = {
    sessionId: `cli_${crypto.randomUUID()}`,
    policy: 'apply',
    assetSources: await authorizeImageSources(args.assetSources ?? []),
    ...(args.assetImportDataRoot === undefined ? {} : { assetImportDataRoot: args.assetImportDataRoot }),
    ...(args.project === undefined ? {} : { projectRoot: args.project }),
    ...(args.change === undefined ? {} : { activeChangeId: args.change }),
  };
  let input = readOptionalJsonFile(args.input);
  if (args.ref !== undefined || args.trace !== undefined || args.query !== undefined) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('--input 必须是 JSON 对象');
    input = { ...input,
      ...(capability === 'object.inspect' && args.ref !== undefined ? { objectRef: args.ref } : {}),
      ...(capability === 'runtime.read-trace' && args.trace !== undefined ? { traceId: args.trace } : {}),
      ...(capability === 'runtime.read-trace' && args.query !== undefined ? { query: readJsonFile(args.query) } : {}),
    };
  }
  return dispatchAuthoringCapability(context, capability, input, service);
}

export async function authoringCommand(args: readonly string[]): Promise<number> {
  const command = args[0] ?? '';
  const subcommand = args[1] ?? '';
  const rawThird = args[2] ?? '';
  const subsubcommand = rawThird.length > 0 && !rawThird.startsWith('--') ? rawThird : '';
  let parsed: ParsedArgs = { json: false, debug: false };
  let capability = subsubcommand.length > 0 ? `${command}.${subcommand}.${subsubcommand}` : `${command}.${subcommand}`;
  const sessionId = `cli_${crypto.randomUUID()}`;
  try {
    parsed = parseArgs(args.slice(subsubcommand.length > 0 ? 3 : 2));
    const parsedCapability = capabilityFor(command, subcommand, subsubcommand);
    capability = parsedCapability;
    const dispatched = await dispatchCli(new AuthoringService(), parsedCapability, parsed);
    const value = dispatched.value;
    const envelope = createSuccessEnvelope({
      sessionId,
      capability,
      projectIdentity: value.projectIdentity,
      projectRevision: value.projectRevision,
      ...(value.changeId === undefined ? {} : { changeId: value.changeId }),
      ...(value.workingRevision === undefined ? {} : { workingRevision: value.workingRevision }),
      ...(value.workingSnapshotRevision === undefined ? {} : { workingSnapshotRevision: value.workingSnapshotRevision }),
      ...(dispatched.operationId === undefined ? {} : { operationId: dispatched.operationId }),
    }, value.result);
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return 0;
  } catch (error) {
    if (parsed.debug) process.stderr.write(`${error instanceof Error && error.stack ? error.stack : String(error)}\n`);
    const envelope = createFailureEnvelope({
      sessionId,
      capability,
      projectIdentity: 'unknown',
    }, error);
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return 1;
  }
}

export { AUTHORING_CONTRACT_VERSION };
