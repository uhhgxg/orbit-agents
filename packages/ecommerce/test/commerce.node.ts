// Node-only suite, invoked explicitly by this package's test script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturePath } from '../src/assets.js';
import {
  loadSnapshot,
  SnapshotSource,
  validateEvidence,
} from '../src/sources.js';
import { OperationLedger } from '../src/ledger.js';
import { checkOperation, reviewReport } from '../src/policy.js';
import { OperationSchema, type Operation } from '../src/contracts.js';
import { CommerceTools, ROLE_TOOLS } from '../src/tools.js';
import { TraceRecorder, redact } from '../src/trace.js';
import { replay } from '../src/replay.js';

const snapshot = loadSnapshot(fixturePath());
const now = () => new Date(snapshot.asOf);
const op = (action: Operation['action'] = 'change_price'): Operation =>
  OperationSchema.parse({
    operationId: 'operation_test_001',
    sku: 'SKU-001',
    snapshotId: snapshot.id,
    currency: 'CNY',
    action,
    amountMinor: 12000,
    quantity: 10,
    evidenceIds: snapshot.evidence.map((e) => e.id),
  });
test('schema rejects fractional monetary values and missing required action parameters', () => {
  assert.equal(
    OperationSchema.safeParse({ ...op(), amountMinor: 1.1 }).success,
    false,
  );
  assert.equal(
    OperationSchema.safeParse({ ...op(), amountMinor: undefined }).success,
    false,
  );
});
test('source does not silently merge mismatched SKUs or windows', async () => {
  const source = new SnapshotSource(snapshot);
  await assert.rejects(
    source.query('inventory', {
      sku: 'UNKNOWN',
      window: snapshot.evidence[0]!.window,
    }),
  );
  const broken = structuredClone(snapshot);
  broken.evidence[1]!.sku = 'OTHER';
  await assert.rejects(
    new SnapshotSource(broken).query('inventory', {
      sku: 'SKU-001',
      window: snapshot.evidence[0]!.window,
    }),
  );
});
test('evidence rejects stale timestamps, future observations and mixed currency', () => {
  assert.deepEqual(validateEvidence(snapshot.evidence, now()), []);
  const rows = structuredClone(snapshot.evidence);
  rows[0]!.currency = 'USD';
  rows[1]!.observedAt = '2026-11-01T00:00:00Z';
  assert.ok(validateEvidence(rows, now()).includes('currency_mismatch'));
  assert.ok(
    validateEvidence(rows, now()).some((x) =>
      x.startsWith('stale_or_unavailable'),
    ),
  );
});
test('all four operations require human approval', () => {
  for (const action of [
    'change_price',
    'change_budget',
    'replenish',
    'delist',
  ] as const)
    assert.equal(
      checkOperation(op(action), snapshot.evidence, now()).status,
      'human_review',
    );
});
test('business rules block margin violation, budget excess and promotion conflict', () => {
  assert.ok(
    checkOperation(
      { ...op(), amountMinor: 100 },
      snapshot.evidence,
      now(),
    ).reasons.includes('margin_floor'),
  );
  assert.ok(
    checkOperation(
      { ...op('change_budget'), amountMinor: 100001 },
      snapshot.evidence,
      now(),
    ).reasons.includes('budget_ceiling'),
  );
  const rows = structuredClone(snapshot.evidence);
  rows.find((e) => e.kind === 'promotions')!.values['active'] = true;
  assert.ok(
    checkOperation(op(), rows, now()).reasons.includes('promotion_conflict'),
  );
});
test('reviewer downgrades unsupported evidence and uncertainties', () => {
  assert.equal(
    reviewReport(
      {
        summary: 'test',
        evidenceIds: ['missing'],
        conclusions: [],
        uncertainties: [],
      },
      snapshot.evidence,
      now(),
    ).status,
    'needs_evidence',
  );
  assert.equal(
    reviewReport(
      {
        summary: 'test',
        evidenceIds: ['catalog-1'],
        conclusions: [{ claim: 'known fact', evidenceIds: ['catalog-1'] }],
        uncertainties: ['causality unknown'],
      },
      snapshot.evidence,
      now(),
    ).status,
    'human_review',
  );
});
test('parameter hash, approval expiry and missing approval are enforced', async () => {
  const ledger = new OperationLedger(':memory:', now);
  try {
    const row = ledger.request(op(), snapshot.evidence);
    await assert.rejects(
      ledger.execute(row.id, snapshot.evidence, ledger.snapshotExecutor()),
    );
    assert.throws(() => ledger.approve(row.id, 'different-hash', 'operator'));
    ledger.approve(row.id, row.hash, 'operator');
    assert.throws(() =>
      ledger.request({ ...op(), amountMinor: 13000 }, snapshot.evidence),
    );
    const changed = structuredClone(snapshot.evidence);
    changed.find((e) => e.kind === 'catalog')!.values.costMinor = 11999;
    await assert.rejects(
      ledger.execute(row.id, changed, ledger.snapshotExecutor()),
    );
  } finally {
    ledger.close();
  }
});
test('expired approval is not reused', async () => {
  let time = now();
  const ledger = new OperationLedger(':memory:', () => time);
  try {
    const row = ledger.request(op(), snapshot.evidence);
    ledger.approve(row.id, row.hash, 'operator', 100);
    time = new Date(time.getTime() + 101);
    await assert.rejects(
      ledger.execute(row.id, snapshot.evidence, ledger.snapshotExecutor()),
      /operation_test/,
    );
  } finally {
    ledger.close();
  }
});
test('concurrent requests produce at most one external execution', async () => {
  const ledger = new OperationLedger(':memory:', now);
  let count = 0;
  try {
    const row = ledger.request(op(), snapshot.evidence);
    ledger.approve(row.id, row.hash, 'operator');
    const executor = {
      execute: async () => {
        count++;
        await new Promise((r) => setTimeout(r, 10));
        return { receipt: 'ok' };
      },
      reconcile: async () => null,
    };
    const results = await Promise.allSettled([
      ledger.execute(row.id, snapshot.evidence, executor),
      ledger.execute(row.id, snapshot.evidence, executor),
    ]);
    assert.equal(count, 1);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    await ledger.execute(row.id, snapshot.evidence, executor);
    assert.equal(count, 1);
  } finally {
    ledger.close();
  }
});
test('unknown external results are frozen, then reconciled after a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'commerce-ledger-'));
  const file = join(root, 'ledger.sqlite');
  let ledger = new OperationLedger(file, now);
  try {
    const row = ledger.request(op(), snapshot.evidence);
    ledger.approve(row.id, row.hash, 'operator');
    await assert.rejects(
      ledger.execute(row.id, snapshot.evidence, {
        execute: async () => {
          throw new Error('timeout after write');
        },
        reconcile: async () => null,
      }),
    );
    assert.equal(ledger.get(row.id)!.status, 'unknown');
    ledger.close();
    ledger = new OperationLedger(file, now);
    await assert.rejects(
      ledger.execute(row.id, snapshot.evidence, ledger.snapshotExecutor()),
    );
    await ledger.reconcile(row.id, {
      execute: async () => {
        throw new Error('must not execute');
      },
      reconcile: async () => ({ receipt: 'external-confirmed' }),
    });
    assert.equal(ledger.get(row.id)!.status, 'succeeded');
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test('read-only role has neither approval nor execution capability', async () => {
  const ledger = new OperationLedger(':memory:', now);
  try {
    const tools = new CommerceTools(
      'reviewer',
      new SnapshotSource(snapshot),
      ledger,
      new TraceRecorder('run', 'review'),
      now,
      '.state/artifacts',
    );
    await assert.rejects(
      tools.call('execute_operation', { operationId: 'op' }),
      /reviewer/,
    );
    assert.ok(
      Object.values(ROLE_TOOLS).every(
        (names) => !names.includes('approve_operation'),
      ),
    );
  } finally {
    ledger.close();
  }
});
test('trace redacts credentials recursively', () => {
  assert.deepEqual(redact({ nested: { apiKey: 'secret', sku: 'ok' } }), {
    nested: { apiKey: '[REDACTED]', sku: 'ok' },
  });
});
test('operator authentication is persisted and cannot be replaced by caller-supplied configuration', () => {
  const ledger = new OperationLedger(':memory:', now);
  try {
    assert.throws(() => ledger.authorizeOperator('caller-chosen-token'));
    ledger.configureOperator('a'.repeat(32));
    assert.throws(() => ledger.configureOperator('b'.repeat(32)));
    assert.throws(() => ledger.authorizeOperator('b'.repeat(32)));
    assert.doesNotThrow(() => ledger.authorizeOperator('a'.repeat(32)));
  } finally {
    ledger.close();
  }
});
test('full deterministic replay collects evidence, reviews and waits for human approval', async () => {
  const root = mkdtempSync(join(tmpdir(), 'commerce-replay-'));
  try {
    const result = await replay(snapshot, root);
    assert.equal(result.evaluation.passed, true);
    assert.equal(result.report.uncertainties.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
