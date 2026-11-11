import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  QuerySchema,
  OperationSchema,
  DomainError,
  type Role,
} from './contracts.js';
import { ApiSource, loadSnapshot, SnapshotSource } from './sources.js';
import { OperationLedger } from './ledger.js';
import { TraceRecorder, shutdownCommerceTracing } from './trace.js';
import { CommerceTools, ROLE_TOOLS, IdSchema, ReviewSchema } from './tools.js';
import { fixturePath } from './assets.js';
import { ApiOperationExecutor } from './api-executor.js';

const role = process.env['ECOMMERCE_ROLE'] ?? 'reviewer';
if (!Object.hasOwn(ROLE_TOOLS, role)) throw new Error('Invalid ECOMMERCE_ROLE');
const fixture = process.env['ECOMMERCE_SNAPSHOT'] ?? fixturePath();
const state = resolve(process.env['ECOMMERCE_STATE_DIR'] ?? '.state');
const snapshot = loadSnapshot(fixture);
const source = process.env['ECOMMERCE_API_BASE_URL']
  ? new ApiSource(
      new URL(process.env['ECOMMERCE_API_BASE_URL']),
      process.env['ECOMMERCE_API_TOKEN'] ?? '',
    )
  : new SnapshotSource(snapshot);
const now =
  process.env['ECOMMERCE_REPLAY'] === 'true'
    ? () => new Date(snapshot.asOf)
    : () => new Date();
const ledger = new OperationLedger(
  join(state, 'operations.sqlite'),
  () => new Date(),
  now,
);
const trace = new TraceRecorder(
  process.env['ECOMMERCE_RUN_ID'] ?? randomUUID(),
  role,
  join(state, `${role}-trace.jsonl`),
);
trace.enableLangfuse();
const executor = process.env['ECOMMERCE_API_BASE_URL']
  ? new ApiOperationExecutor(
      new URL(process.env['ECOMMERCE_API_BASE_URL']),
      process.env['ECOMMERCE_API_TOKEN'] ?? '',
    )
  : ledger.snapshotExecutor();
const service = new CommerceTools(
  role as Role,
  source,
  ledger,
  trace,
  now,
  join(state, 'artifacts'),
  executor,
);
const server = new McpServer({ name: 'commerce-evidence', version: '0.1.0' });
for (const name of ROLE_TOOLS[role as Role]) {
  const schema = name.startsWith('query_')
    ? QuerySchema
    : name === 'review_report'
      ? ReviewSchema
      : name === 'request_operation'
        ? OperationSchema
        : IdSchema;
  server.registerTool(
    name,
    {
      description: `Commerce ${name}. Role=${role}. Snapshot evidence is not live production data. Approvals are out-of-band; no tool can grant approval.`,
      inputSchema: schema,
      annotations: {
        readOnlyHint:
          name.startsWith('query_') ||
          ['review_report', 'operation_status'].includes(name),
        destructiveHint: name === 'execute_operation',
      },
    },
    async (args: unknown) => {
      try {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(await service.call(name, args)),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                code:
                  error instanceof DomainError
                    ? error.code
                    : error instanceof z.ZodError
                      ? 'invalid_input'
                      : 'internal_error',
                message:
                  error instanceof DomainError || error instanceof z.ZodError
                    ? error.message
                    : 'Tool execution failed; inspect local trace',
              }),
            },
          ],
        };
      }
    },
  );
}
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  await trace.shutdown();
  await shutdownCommerceTracing();
  ledger.close();
}
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
await server.connect(new StdioServerTransport());
