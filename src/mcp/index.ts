import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { MeloPulseService } from '../service.js';
import { createMcpServer } from './server.js';

export function serveMcp(service: MeloPulseService): StdioServerHandle {
  return serveStdio(() => createMcpServer(service));
}
