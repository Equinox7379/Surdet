#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { normalizeAuthoringError } from '@surdet/authoring';
import { parseAgentPortArgs } from './args.js';
import { createAgentPortServer } from './server.js';
import { openAgentPortSession } from './session.js';

async function main(): Promise<void> {
  let session: Awaited<ReturnType<typeof openAgentPortSession>> | undefined;
  let handle: Awaited<ReturnType<typeof serveStdio>> | undefined;
  try {
    const options = parseAgentPortArgs(process.argv.slice(2));
    session = await openAgentPortSession(options);
    handle = serveStdio(() => createAgentPortServer(session!), { legacy: 'reject', onerror: (error) => process.stderr.write(`MCP: ${error.message}\n`) });
    process.stderr.write(`Surdet Agent Port ready: ${session.projectIdentity} (${session.policy})\n`);

    let closing = false;
    const close = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      await handle?.close();
      await session?.close();
    };
    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
  } catch (error) {
    const normalized = normalizeAuthoringError(error);
    process.stderr.write(`Surdet Agent Port failed: ${normalized.code}: ${normalized.message}\n`);
    process.exitCode = 1;
  }
}

void main();
