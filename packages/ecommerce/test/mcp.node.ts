// Node-only suite: the MCP subprocess and SQLite addon use the Node runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OperationLedger } from '../src/ledger.js';
import { scoreTrace } from '../src/eval.js';
import type { TraceEvent } from '../src/trace.js';

test(
  'real MCP stdio handshake advertises only reviewer tools and validates requests',
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'commerce-mcp-'));
    const client = new Client({ name: 'contract-test', version: '1' });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => v !== undefined && !/LANGFUSE|EVAL_JUDGE|ECOMMERCE/.test(k),
      ),
    ) as Record<string, string>;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL('../dist/src/mcp-server.js', import.meta.url)),
      ],
      env: {
        ...env,
        ECOMMERCE_ROLE: 'reviewer',
        ECOMMERCE_REPLAY: 'true',
        ECOMMERCE_STATE_DIR: root,
      },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some((t) => t.name === 'review_report'));
      assert.ok(
        !tools.tools.some(
          (t) =>
            t.name === 'execute_operation' || t.name === 'request_operation',
        ),
      );
      const result = await client.callTool({
        name: 'query_inventory',
        arguments: {
          sku: 'SKU-001',
          window: {
            start: '2026-10-29T00:00:00Z',
            end: '2026-10-30T00:00:00Z',
          },
        },
      });
      assert.notEqual(result.isError, true);
      assert.ok(JSON.stringify(result).includes('inventory-1'));
      const invalid = await client.callTool({
        name: 'query_inventory',
        arguments: {
          sku: 'NOPE',
          window: {
            start: '2026-10-29T00:00:00Z',
            end: '2026-10-30T00:00:00Z',
          },
        },
      });
      assert.equal(invalid.isError, true);
    } finally {
      await client.close();
      await transport.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'coordinator MCP writes require out-of-band approval and commit one replayable effect',
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'commerce-mcp-write-'));
    const client = new Client({ name: 'approval-boundary-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL('../dist/src/mcp-server.js', import.meta.url)),
      ],
      env: {
        ECOMMERCE_ROLE: 'coordinator',
        ECOMMERCE_REPLAY: 'true',
        ECOMMERCE_STATE_DIR: root,
      },
    });
    const call = (name: string, input: Record<string, unknown>) =>
      client.callTool({ name, arguments: input });
    let operator: OperationLedger | undefined;
    try {
      await client.connect(transport);
      const query = {
        sku: 'SKU-001',
        window: { start: '2026-10-29T00:00:00Z', end: '2026-10-30T00:00:00Z' },
      };
      await call('query_catalog', query);
      await call('query_inventory', query);
      const operationId = 'mcp_approval_test_001';
      assert.notEqual(
        (
          await call('request_operation', {
            operationId,
            action: 'replenish',
            sku: 'SKU-001',
            snapshotId: 'commerce-20261030-v1',
            currency: 'CNY',
            quantity: 10,
            evidenceIds: ['catalog-1', 'inventory-1'],
          })
        ).isError,
        true,
      );
      assert.equal(
        (await call('execute_operation', { operationId })).isError,
        true,
      );
      operator = new OperationLedger(join(root, 'operations.sqlite'));
      const pending = operator.get(operationId)!;
      assert.equal(pending.status, 'pending');
      // A trusted test operator in this parent process grants approval; the MCP
      // child exposes no approval tool and receives no operator credential.
      operator.approve(operationId, pending.hash, 'test-operator');
      assert.notEqual(
        (await call('execute_operation', { operationId })).isError,
        true,
      );
      assert.notEqual(
        (await call('execute_operation', { operationId })).isError,
        true,
      );
      assert.equal(operator.get(operationId)!.status, 'succeeded');
      const count = operator.db
        .prepare('SELECT COUNT(*) AS count FROM snapshot_effects')
        .get() as { count: number };
      assert.equal(count.count, 1);
      const events = readFileSync(join(root, 'coordinator-trace.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as TraceEvent);
      const validSegment = events.slice(
        events.findIndex(
          (e) =>
            e.type === 'approval' &&
            (e.output as { status?: string } | undefined)?.status ===
              'approved',
        ),
      );
      assert.equal(
        scoreTrace(
          {
            id: 'approved-replay',
            requiredTools: ['execute_operation'],
            requiredEvidence: [],
            before: [],
            expectedSku: 'SKU-001',
            requireApproval: true,
          },
          validSegment,
        ).passed,
        true,
      );
    } finally {
      operator?.close();
      await client.close();
      await transport.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
