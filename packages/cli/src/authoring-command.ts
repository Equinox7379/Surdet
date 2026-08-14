import * as fs from 'node:fs';
import {
  AUTHORING_CAPABILITIES,
  AuthoringService,
  type ServiceResult,
} from './authoring/authoring-service.js';

type ErrorCode =
  | 'CAPABILITY_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_OBJECT_KIND'
  | 'UNSUPPORTED_OPERATION'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_INVALID'
  | 'PATH_OUTSIDE_PROJECT'
  | 'OBJECT_NOT_FOUND'
  | 'OBJECT_AMBIGUOUS'
  | 'OBJECT_REF_STALE'
  | 'OBJECT_PRECONDITION_FAILED'
  | 'CHANGE_NOT_FOUND'
  | 'CHANGE_NOT_OPEN'
  | 'OPERATION_ID_CONFLICT'
  | 'PROJECT_CHANGED_SINCE_BEGIN'
  | 'VALIDATION_REQUIRED'
  | 'VALIDATION_STALE'
  | 'VALIDATION_FAILED'
  | 'SIMULATION_INCOMPLETE'
  | 'RUNTIME_FAILED'
  | 'RUNTIME_TIMED_OUT'
  | 'COMMIT_FAILED_RECOVERED'
  | 'COMMIT_RECOVERY_FAILED';

type ErrorCategory = 'request' | 'not-found' | 'conflict' | 'validation' | 'runtime' | 'commit';

interface ParsedArgs {
  project?: string;
  change?: string;
  ref?: string;
  input?: string;
  trace?: string;
  query?: string;
  json: boolean;
  debug: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false, debug: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--json') parsed.json = true;
    else if (arg === '--debug') parsed.debug = true;
    else if (arg === '--project') parsed.project = args[++index];
    else if (arg === '--change') parsed.change = args[++index];
    else if (arg === '--ref') parsed.ref = args[++index];
    else if (arg === '--input') parsed.input = args[++index];
    else if (arg === '--trace') parsed.trace = args[++index];
    else if (arg === '--query') parsed.query = args[++index];
    else throw new Error(`不支持的 authoring 参数：${arg}`);
  }
  return parsed;
}

function readJsonFile(file: string | undefined): unknown {
  if (file === undefined) throw new Error('写操作需要 --input <json-file> 或 --input -');
  const text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  return JSON.parse(text) as unknown;
}

function readOptionalJsonFile(file: string | undefined): unknown {
  if (file === undefined) return {};
  return readJsonFile(file);
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) throw new Error(`缺少 ${flag}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capabilityFor(command: string, subcommand: string): string {
  const capability = `${command}.${subcommand}`;
  if (!AUTHORING_CAPABILITIES.includes(capability as (typeof AUTHORING_CAPABILITIES)[number])) {
    throw new Error(`未知 authoring 命令：${command} ${subcommand}`);
  }
  return capability;
}

function codeFor(error: unknown): ErrorCode {
  if (error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const code = error.code as ErrorCode;
    if (code !== 'CAPABILITY_UNAVAILABLE' && code !== 'INVALID_REQUEST' && code !== 'UNSUPPORTED_OBJECT_KIND'
      && code !== 'UNSUPPORTED_OPERATION' && code !== 'PROJECT_NOT_FOUND' && code !== 'PROJECT_INVALID'
      && code !== 'PATH_OUTSIDE_PROJECT' && code !== 'OBJECT_NOT_FOUND' && code !== 'OBJECT_AMBIGUOUS'
      && code !== 'OBJECT_REF_STALE' && code !== 'OBJECT_PRECONDITION_FAILED' && code !== 'CHANGE_NOT_FOUND'
      && code !== 'CHANGE_NOT_OPEN' && code !== 'OPERATION_ID_CONFLICT' && code !== 'PROJECT_CHANGED_SINCE_BEGIN'
      && code !== 'VALIDATION_REQUIRED' && code !== 'VALIDATION_STALE' && code !== 'VALIDATION_FAILED'
      && code !== 'SIMULATION_INCOMPLETE' && code !== 'RUNTIME_FAILED' && code !== 'RUNTIME_TIMED_OUT'
      && code !== 'COMMIT_FAILED_RECOVERED' && code !== 'COMMIT_RECOVERY_FAILED') return 'PROJECT_INVALID';
    return code;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('不存在') && message.includes('对象')) return 'OBJECT_NOT_FOUND';
  if (message.includes('Scene') || message.includes('场景') || message.includes('JSON')) return 'PROJECT_INVALID';
  return 'INVALID_REQUEST';
}

function categoryFor(code: ErrorCode): ErrorCategory {
  if (code === 'PROJECT_NOT_FOUND' || code === 'CHANGE_NOT_FOUND' || code === 'OBJECT_NOT_FOUND') return 'not-found';
  if (code === 'PATH_OUTSIDE_PROJECT' || code === 'OBJECT_REF_STALE' || code === 'OBJECT_PRECONDITION_FAILED'
    || code === 'CHANGE_NOT_OPEN' || code === 'OPERATION_ID_CONFLICT' || code === 'PROJECT_CHANGED_SINCE_BEGIN') return 'conflict';
  if (code === 'VALIDATION_REQUIRED' || code === 'VALIDATION_STALE' || code === 'VALIDATION_FAILED'
    || code === 'PROJECT_INVALID' || code === 'SIMULATION_INCOMPLETE') return 'validation';
  if (code === 'RUNTIME_FAILED' || code === 'RUNTIME_TIMED_OUT') return 'runtime';
  if (code === 'COMMIT_FAILED_RECOVERED' || code === 'COMMIT_RECOVERY_FAILED') return 'commit';
  return 'request';
}

function actionFor(code: ErrorCode): string {
  switch (code) {
    case 'PROJECT_NOT_FOUND': return '确认 --project 指向存在的项目目录';
    case 'CHANGE_NOT_FOUND': return '确认 changeId 来自仍保留的 authoring 事务';
    case 'OBJECT_NOT_FOUND': return '先用 object.inspect 或 project.validate 获取当前 objectRef';
    case 'OBJECT_PRECONDITION_FAILED': return '重新读取对象并使用最新指纹提交最小修改';
    case 'VALIDATION_REQUIRED': return '先运行 project.validate，再提交当前 workingRevision';
    case 'VALIDATION_FAILED': return '修复 validation error 后重新校验';
    case 'SIMULATION_INCOMPLETE': return '缩小项目或提高任务允许的模拟预算后重新模拟';
    case 'PROJECT_CHANGED_SINCE_BEGIN': return '重新开始 change，避免覆盖事务外修改';
    case 'COMMIT_RECOVERY_FAILED': return '停止写入，检查项目外 journal 与临时文件后人工恢复';
    default: return '检查请求、项目和上一条结构化错误详情';
  }
}

function successEnvelope(capability: string, value: ServiceResult<unknown>, operationId?: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    capability,
    ok: true,
    ...(operationId === undefined ? {} : { operationId }),
    projectRevision: value.projectRevision,
    ...(value.changeId === undefined ? {} : { changeId: value.changeId }),
    ...(value.workingRevision === undefined ? {} : { workingRevision: value.workingRevision }),
    result: value.result,
  };
}

function failureEnvelope(capability: string, error: unknown): Record<string, unknown> {
  const code = codeFor(error);
  return {
    schemaVersion: 1,
    capability,
    ok: false,
    error: {
      code,
      category: categoryFor(code),
      message: error instanceof Error ? error.message : String(error),
      retriable: code !== 'COMMIT_RECOVERY_FAILED',
      action: actionFor(code),
      ...((error !== null && typeof error === 'object' && 'details' in error && isRecord(error.details))
        ? error.details : {}),
    },
  };
}

async function dispatch(service: AuthoringService, command: string, subcommand: string, args: ParsedArgs): Promise<{ value: ServiceResult<unknown>; operationId?: string }> {
  const capability = capabilityFor(command, subcommand);
  if (capability === 'capabilities.describe') return { value: await service.describeCapabilities() };
  if (capability === 'project.inspect') return { value: await service.inspectProject(required(args.project, '--project')) };
  if (capability === 'project.assets') return { value: await service.projectAssets(required(args.project, '--project')) };
  if (capability === 'object.inspect') return { value: await service.inspectObject(required(args.project, '--project'), required(args.ref, '--ref'), args.change) };
  if (capability === 'change.begin') return { value: await service.begin(required(args.project, '--project')) };
  if (capability === 'scene.create') {
    const input = readJsonFile(args.input) as Parameters<AuthoringService['sceneCreate']>[1];
    return { value: await service.sceneCreate(required(args.change, '--change'), input), operationId: input.operationId };
  }
  if (capability === 'scene.patch') {
    const input = readJsonFile(args.input) as Parameters<AuthoringService['scenePatch']>[1];
    return { value: await service.scenePatch(required(args.change, '--change'), input), operationId: input.operationId };
  }
  if (capability === 'variable.ensure') {
    const input = readJsonFile(args.input) as Parameters<AuthoringService['variableEnsure']>[1];
    return { value: await service.variableEnsure(required(args.change, '--change'), input), operationId: input.operationId };
  }
  if (capability === 'timeline.create') {
    const input = readJsonFile(args.input) as Parameters<AuthoringService['timelineCreate']>[1];
    return { value: await service.timelineCreate(required(args.change, '--change'), input), operationId: input.operationId };
  }
  if (capability === 'timeline.patch') {
    const input = readJsonFile(args.input) as Parameters<AuthoringService['timelinePatch']>[1];
    return { value: await service.timelinePatch(required(args.change, '--change'), input), operationId: input.operationId };
  }
  if (capability === 'project.validate') return { value: await service.validate(required(args.change, '--change')) };
  if (capability === 'project.simulate') {
    const input = readOptionalJsonFile(args.input);
    if (!isRecord(input)) throw new Error('project.simulate 输入必须是 JSON 对象');
    const sceneId = typeof input['sceneId'] === 'string' ? input['sceneId'] : undefined;
    return { value: await service.simulate(required(args.change, '--change'), { sceneId }) };
  }
  if (capability === 'runtime.run-from') {
    const input = readJsonFile(args.input);
    if (!isRecord(input)) throw new Error('runtime.run-from 输入必须是 JSON 对象');
    return { value: await service.runFrom(required(args.change, '--change'), input) };
  }
  if (capability === 'runtime.read-trace') {
    const query = readOptionalJsonFile(args.query);
    if (!isRecord(query)) throw new Error('runtime.read-trace query 必须是 JSON 对象');
    return { value: await service.readTrace(required(args.change, '--change'), required(args.trace, '--trace'), query) };
  }
  if (capability === 'change.diff') return { value: await service.diff(required(args.change, '--change')) };
  if (capability === 'change.commit') return { value: await service.commit(required(args.change, '--change')) };
  if (capability === 'change.rollback') return { value: await service.rollback(required(args.change, '--change')) };
  throw new Error(`未实现 authoring 命令：${capability}`);
}

export async function authoringCommand(args: readonly string[]): Promise<number> {
  const command = args[0] ?? '';
  const subcommand = args[1] ?? '';
  let parsed: ParsedArgs = { json: false, debug: false };
  let capability = `${command}.${subcommand}`;
  try {
    parsed = parseArgs(args.slice(2));
    capability = capabilityFor(command, subcommand);
    const dispatched = await dispatch(new AuthoringService(), command, subcommand, parsed);
    process.stdout.write(`${JSON.stringify(successEnvelope(capability, dispatched.value, dispatched.operationId))}\n`);
    return 0;
  } catch (error) {
    if (parsed.debug) process.stderr.write(`${error instanceof Error && error.stack ? error.stack : String(error)}\n`);
    process.stdout.write(`${JSON.stringify(failureEnvelope(capability, error))}\n`);
    return 1;
  }
}
