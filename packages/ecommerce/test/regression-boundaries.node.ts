// Node-only suite, kept outside Bun's automatic .test/.spec discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturePath } from '../src/assets.js';
import { loadSnapshot } from '../src/sources.js';
import { benchmark } from '../src/benchmark.js';
import { OperationLedger } from '../src/ledger.js';
import { OperationSchema } from '../src/contracts.js';
import { scoreTrace } from '../src/eval.js';
import type { TraceEvent } from '../src/trace.js';

test('benchmark variants preserve their actual evidence with immutable, reopenable references', async () => {
  const root = mkdtempSync(join(tmpdir(), 'benchmark-artifacts-'));
  try {
    const source = loadSnapshot(fixturePath());
    const first = await benchmark(source, root);
    const second = await benchmark(source, root);
    assert.equal(first.length, 3);
    for (let index = 0; index < first.length; index++) {
      const result = first[index]!;
      const saved = loadSnapshot(result.snapshotFile);
      assert.equal(result.passed, true);
      assert.equal(saved.id, result.snapshotId);
      assert.equal(second[index]!.snapshotFile, result.snapshotFile);
      for (const evidence of saved.evidence)
        assert.equal(evidence.rawRef.split('#')[0], result.snapshotFile);
      if (result.id === 'promotion-conflict')
        assert.equal(
          saved.evidence.find((e) => e.kind === 'promotions')!.values.active,
          true,
        );
    }
    assert.equal(
      source.evidence.find((e) => e.kind === 'promotions')!.values.active,
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replaying historical evidence does not freeze the real approval expiration clock', async () => {
  const snapshot = loadSnapshot(fixturePath());
  let wallTime = new Date('2026-10-31T00:00:00Z');
  const ledger = new OperationLedger(
    ':memory:',
    () => wallTime,
    () => new Date(snapshot.asOf),
  );
  try {
    const operation = OperationSchema.parse({
      operationId: 'replay_clock_001',
      action: 'replenish',
      sku: 'SKU-001',
      snapshotId: snapshot.id,
      currency: snapshot.currency,
      quantity: 1,
      evidenceIds: snapshot.evidence.map((e) => e.id),
    });
    const row = ledger.request(operation, snapshot.evidence);
    ledger.approve(row.id, row.hash, 'operator', 1000);
    wallTime = new Date(wallTime.getTime() + 1001);
    await assert.rejects(
      ledger.execute(row.id, snapshot.evidence, ledger.snapshotExecutor()),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'approval_expired',
    );
  } finally {
    ledger.close();
  }
});

test('trace scoring binds every write to its own operation and approved parameter hash', () => {
  const base = {
    id: 'event',
    at: '2026-10-31T00:00:00Z',
    runId: 'run',
    sessionId: 'session',
  };
  const grant: TraceEvent = {
    ...base,
    type: 'approval',
    output: { operationId: 'op-a', hash: 'hash-a', status: 'approved' },
  };
  const write: TraceEvent = {
    ...base,
    type: 'tool',
    tool: 'execute_operation',
    input: { operationId: 'op-a' },
    output: { hash: 'hash-a' },
  };
  const check = (events: TraceEvent[]) =>
    scoreTrace(
      {
        id: 'approval-scope',
        requiredTools: [],
        requiredEvidence: [],
        expectedSku: 'SKU-001',
        before: [],
        requireApproval: true,
      },
      events,
    ).passed;
  assert.equal(check([grant, write]), true);
  assert.equal(
    check([grant, { ...write, input: { operationId: 'op-b' } }]),
    false,
  );
  assert.equal(
    check([grant, { ...write, output: { hash: 'changed' } }]),
    false,
  );
  assert.equal(
    check([grant, write, { ...write, input: { operationId: 'op-b' } }]),
    false,
  );
});
