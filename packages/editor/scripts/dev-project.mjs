import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FORBIDDEN_PORTS = new Set([4173, 4175]);

function defaultDataRoot() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA;
    if (base) return path.join(base, 'Surdet', 'asset-import-authority', 'v1');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Surdet', 'asset-import-authority', 'v1');
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'surdet', 'asset-import-authority', 'v1');
}

function absoluteArgument(value, field) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw new Error(`${field} 必须是绝对路径`);
  }
  return path.resolve(value);
}

export function parseDevProjectArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!['--project', '--data-root', '--port'].includes(key) || value === undefined || values.has(key)) {
      throw new Error('参数必须使用不重复的 --project、--data-root 或 --port 键值对');
    }
    values.set(key, value);
  }
  if (!values.has('--project')) throw new Error('缺少 --project');
  const portText = values.get('--port') ?? '5174';
  if (!/^(?:[1-9][0-9]{0,4})$/.test(portText)) throw new Error('--port 必须是十进制端口');
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || FORBIDDEN_PORTS.has(port)) {
    throw new Error('端口不可用；4173 与 4175 为保留冲突端口');
  }
  return {
    projectRoot: absoluteArgument(values.get('--project'), '--project'),
    dataRoot: values.has('--data-root')
      ? absoluteArgument(values.get('--data-root'), '--data-root')
      : path.resolve(defaultDataRoot()),
    host: '127.0.0.1',
    port,
  };
}

export async function startDevProject(args = process.argv.slice(2), runtimeOptions = { registerSignals: true }) {
  const options = parseDevProjectArguments(args);
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const environmentKeys = [
    'SURDET_EDITOR_PROJECT_LAUNCHER',
    'SURDET_EDITOR_PROJECT_ROOT',
    'SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT',
  ];
  const withBoundEnvironment = async (action) => {
    const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
    try {
      process.env.SURDET_EDITOR_PROJECT_LAUNCHER = '1';
      process.env.SURDET_EDITOR_PROJECT_ROOT = options.projectRoot;
      process.env.SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT = options.dataRoot;
      return await action();
    } finally {
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  const server = await withBoundEnvironment(async () => {
    const { createServer } = await import('vite');
    return createServer({
      root: packageRoot,
      configFile: path.join(packageRoot, 'vite.config.ts'),
      ...(typeof runtimeOptions.cacheDir === 'string' && runtimeOptions.cacheDir.length > 0
        ? { cacheDir: runtimeOptions.cacheDir }
        : {}),
      server: { host: '127.0.0.1', port: options.port, strictPort: true },
      ...(runtimeOptions.disableDependencyDiscovery === true
        ? { optimizeDeps: { noDiscovery: true, include: runtimeOptions.optimizedDependencies ?? [] } }
        : {}),
    });
  });
  const readyAuthority = async () => {
    const authorityPlugin = server.config.plugins.find(
      (plugin) => plugin.name === 'surdet-project-asset-import-authority',
    );
    if (typeof authorityPlugin?.api?.ready !== 'function') {
      throw new Error('素材导入写入服务插件未就绪');
    }
    await authorityPlugin.api.ready();
  };
  // Vite reloads its config on restart; keep this server's project binding for that read too.
  const restart = server.restart.bind(server);
  let pendingRestart;
  const restartBound = (forceOptimize) => {
    pendingRestart ??= withBoundEnvironment(async () => {
      await restart(forceOptimize);
      await readyAuthority();
    }).finally(() => {
      // Vite replaces the public methods with those of its replacement server.
      server.restart = restartBound;
      pendingRestart = undefined;
    });
    return pendingRestart;
  };
  server.restart = restartBound;
  try {
    await readyAuthority();
    await server.listen();
    server.printUrls();
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
  if (runtimeOptions.registerSignals !== false) {
    const stop = () => { void server.close().finally(() => process.exit(0)); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
  return server;
}

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  startDevProject().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`无法启动绑定项目的 Editor：${message}\n`);
    process.exitCode = 1;
  });
}
