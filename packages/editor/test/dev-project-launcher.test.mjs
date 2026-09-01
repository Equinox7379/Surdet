import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, it } from 'vitest';

const launcherFile = path.resolve('scripts/dev-project.mjs');
const roots = [];

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing port');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('bound project Editor launcher', () => {
  it('parses a platform-native temporary absolute project, an optional persistent data root, and strict port 5174 defaults', async () => {
    const launcher = await import(pathToFileURL(launcherFile).href);
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-editor-argument-fixture-'));
    roots.push(fixtureRoot);
    const projectRoot = path.join(fixtureRoot, 'project');
    await fs.mkdir(projectRoot);
    const parsed = launcher.parseDevProjectArguments(['--project', projectRoot]);
    assert.equal(parsed.projectRoot, path.resolve(projectRoot));
    assert.equal(path.isAbsolute(projectRoot), true);
    assert.equal(path.isAbsolute(parsed.dataRoot), true);
    assert.equal(parsed.port, 5174);
    assert.equal(parsed.host, '127.0.0.1');
  });

  it('rejects a Windows-style project path on POSIX hosts', async () => {
    if (process.platform === 'win32') return;
    const launcher = await import(pathToFileURL(launcherFile).href);
    assert.throws(() => launcher.parseDevProjectArguments(['--project', 'C:\\fixture\\project']));
  });

  it('rejects forbidden shared ports, relative paths, duplicates, and unknown arguments', async () => {
    const launcher = await import(pathToFileURL(launcherFile).href);
    for (const args of [
      ['--project', 'relative'],
      ['--project', 'C:\\fixture', '--port', '4173'],
      ['--project', 'C:\\fixture', '--port', '4175'],
      ['--project', 'C:\\one', '--project', 'C:\\two'],
      ['--project', 'C:\\fixture', '--unknown', 'value'],
    ]) assert.throws(() => launcher.parseDevProjectArguments(args));
  });

  it('starts Vite programmatically on loopback with strict ownership and leaves ordinary dev unbound', async () => {
    const source = await fs.readFile(launcherFile, 'utf8');
    const config = await fs.readFile(path.resolve('vite.config.ts'), 'utf8');
    assert.match(source, /createServer/);
    assert.match(source, /127\.0\.0\.1/);
    assert.match(source, /strictPort:\s*true/);
    assert.match(source, /SURDET_EDITOR_PROJECT_LAUNCHER/);
    assert.match(config, /SURDET_EDITOR_PROJECT_LAUNCHER/);
    assert.match(config, /assetImportAuthorityVitePlugin/);
    assert.match(config, /undefined/);
  });

  it('keeps the ordinary Vite development surface unbound', async () => {
    delete process.env.SURDET_EDITOR_PROJECT_LAUNCHER;
    delete process.env.SURDET_EDITOR_PROJECT_ROOT;
    delete process.env.SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT;
    const port = await freePort();
    const { createServer } = await import('vite');
    const server = await createServer({
      root: path.resolve('.'),
      configFile: path.resolve('vite.config.ts'),
      server: { host: '127.0.0.1', port, strictPort: true },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      await server.listen();
      const main = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      assert.doesNotMatch(main, /data-surdet-asset-import-authority/);
    } finally {
      await server.close();
    }
  }, 30_000);

  it('serves authority config only on the bound main page and releases its project lease on close', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-editor-bound-launcher-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const dataRoot = path.join(root, 'data');
    await fs.mkdir(path.join(projectRoot, 'content', 'assets'), { recursive: true });
    const port = await freePort();
    const launcher = await import(pathToFileURL(launcherFile).href);
    const args = ['--project', projectRoot, '--data-root', dataRoot, '--port', String(port)];
    const first = await launcher.startDevProject(args, { registerSignals: false, disableDependencyDiscovery: true });
    try {
      const main = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      const preview = await (await fetch(`http://127.0.0.1:${port}/preview.html`)).text();
      assert.match(main, /data-surdet-asset-import-authority/);
      assert.doesNotMatch(preview, /data-surdet-asset-import-authority/);
      const match = main.match(/__SURDET_ASSET_IMPORT_AUTHORITY__=Object\.freeze\((\{[^<]+\})\);/);
      if (match === null) throw new Error('missing injected authority config');
      const authorityConfig = JSON.parse(match[1]);
      const origin = `http://127.0.0.1:${port}`;
      const authorityHeaders = {
        Origin: origin,
        'Content-Type': 'application/json',
        'x-surdet-asset-import-authority': authorityConfig.token,
      };
      const status = await fetch(`${origin}${authorityConfig.endpoint}/status`, {
        method: 'POST', headers: authorityHeaders, body: JSON.stringify({ browserSessionId: 'launcher-browser' }),
      });
      assert.equal(status.status, 200);
      assert.match((await status.json()).data.projectIdentity, /^[0-9a-f]{64}$/);
      const challengeResponse = await fetch(`${origin}${authorityConfig.endpoint}/binding/challenges`, {
        method: 'POST', headers: authorityHeaders, body: JSON.stringify({ browserSessionId: 'launcher-browser' }),
      });
      const challenge = (await challengeResponse.json()).data;
      const probe = JSON.parse(await fs.readFile(path.join(projectRoot, challenge.relativeProbePath), 'utf8'));
      const confirmation = await fetch(`${origin}${authorityConfig.endpoint}/binding/challenges/${challenge.challengeId}/confirm`, {
        method: 'POST',
        headers: authorityHeaders,
        body: JSON.stringify({ browserSessionId: 'launcher-browser', nonce: probe.nonce }),
      });
      const confirmed = (await confirmation.json()).data;
      assert.match(confirmed.bindingToken, /^[0-9a-f]{64}$/);
      await assert.rejects(fs.readFile(path.join(projectRoot, challenge.relativeProbePath)));
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await first.close();
    }

    const second = await launcher.startDevProject(args, { registerSignals: false, disableDependencyDiscovery: true });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(response.ok, true);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await second.close();
    }
  }, 30_000);

  it('fails closed on an occupied port without stopping or replacing its owner', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-editor-occupied-port-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const dataRoot = path.join(root, 'data');
    await fs.mkdir(projectRoot, { recursive: true });
    const owner = net.createServer();
    await new Promise((resolve, reject) => {
      owner.once('error', reject);
      owner.listen(0, '127.0.0.1', resolve);
    });
    const address = owner.address();
    if (address === null || typeof address === 'string') throw new Error('missing occupied port');
    try {
      const launcher = await import(pathToFileURL(launcherFile).href);
      await assert.rejects(launcher.startDevProject([
        '--project', projectRoot,
        '--data-root', dataRoot,
        '--port', String(address.port),
      ], { registerSignals: false, disableDependencyDiscovery: true }));
      assert.equal(owner.listening, true);
    } finally {
      await new Promise((resolve) => owner.close(resolve));
    }
    const launcher = await import(pathToFileURL(launcherFile).href);
    const replacement = await launcher.startDevProject([
      '--project', projectRoot,
      '--data-root', dataRoot,
      '--port', String(address.port),
    ], { registerSignals: false, disableDependencyDiscovery: true });
    await replacement.close();
  }, 30_000);
});
