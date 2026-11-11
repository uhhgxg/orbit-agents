import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSnapshot, SnapshotSource } from './sources.js';
import { replay } from './replay.js';
import { OperationLedger } from './ledger.js';
import { scoreTrace, judgeReport } from './eval.js';
import { fixturePath } from './assets.js';
import { benchmark } from './benchmark.js';
import { shutdownCommerceTracing } from './trace.js';

const command = process.argv[2] ?? 'demo';
const state = resolve(process.env['ECOMMERCE_STATE_DIR'] ?? '.state');
const snapshot = loadSnapshot(
  process.env['ECOMMERCE_SNAPSHOT'] ?? fixturePath(),
);
try {
  if (['demo', 'eval'].includes(command)) {
    const result = await replay(snapshot, state);
    const query = snapshot.evidence[0]!;
    const test = {
      id: 'inventory-order-promotion',
      requiredTools: ['query_inventory', 'query_orders', 'query_promotions'],
      expectedSku: query.sku,
      requiredEvidence: snapshot.evidence.map((e) => e.id),
      before: [['query_inventory', 'review_report']] as Array<[string, string]>,
      requireApproval: true,
    };
    const mutations = [
      {
        id: 'missing-tool',
        events: result.events.filter((e) => e.tool !== 'query_inventory'),
      },
      {
        id: 'wrong-sku',
        events: result.events.map((e) =>
          e.tool === 'query_orders' ? { ...e, input: { sku: 'WRONG' } } : e,
        ),
      },
      { id: 'order-drift', events: [...result.events].reverse() },
      {
        id: 'unapproved-write',
        events: [
          ...result.events,
          {
            id: 'bad',
            runId: 'bad',
            sessionId: 'bad',
            at: snapshot.asOf,
            type: 'tool' as const,
            tool: 'execute_operation',
          },
        ],
      },
    ].map((v) => ({
      mutation: v.id,
      ...scoreTrace({ ...test, id: v.id }, v.events),
    }));
    let judge: unknown = {
      status: 'skipped',
      reason:
        'Configure EVAL_JUDGE_URL, EVAL_JUDGE_API_KEY and EVAL_JUDGE_MODEL for real model evaluation',
    };
    if (
      process.env['EVAL_JUDGE_URL'] &&
      process.env['EVAL_JUDGE_API_KEY'] &&
      process.env['EVAL_JUDGE_MODEL']
    )
      judge = await judgeReport(
        {
          report: result.report,
          evidence: snapshot.evidence,
          allowedEvidenceIds: snapshot.evidence.map((e) => e.id),
        },
        {
          url: process.env['EVAL_JUDGE_URL'],
          apiKey: process.env['EVAL_JUDGE_API_KEY'],
          model: process.env['EVAL_JUDGE_MODEL'],
        },
      );
    const businessCases = await benchmark(snapshot, join(state, 'benchmark'));
    const output = {
      mode: 'deterministic-replay',
      snapshotId: snapshot.id,
      referenceTime: snapshot.asOf,
      baseline: result.evaluation,
      businessCases,
      mutations,
      judge,
      report: result.report,
    };
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/latest.json', JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
    if (
      !result.evaluation.passed ||
      mutations.some((m) => m.passed) ||
      businessCases.some((c) => !c.passed)
    )
      process.exitCode = 1;
  } else if (
    ['operator-init', 'approve', 'execute', 'status', 'reconcile'].includes(
      command,
    )
  ) {
    const ledger = new OperationLedger(
      join(state, 'operations.sqlite'),
      () => new Date(),
      () =>
        process.env['ECOMMERCE_REPLAY'] === 'true'
          ? new Date(snapshot.asOf)
          : new Date(),
    );
    const id = process.argv[3] ?? '';
    try {
      if (command === 'approve') {
        // Only the operator process receives this secret. Do not put it in the MCP source environment.
        ledger.authorizeOperator(process.env['ECOMMERCE_OPERATOR_AUTH'] ?? '');
        const hash = process.argv[4] ?? '';
        ledger.approve(
          id,
          hash,
          process.env['ECOMMERCE_OPERATOR_NAME'] ?? 'local-operator',
        );
      }
      if (command === 'operator-init')
        ledger.configureOperator(process.env['ECOMMERCE_OPERATOR_AUTH'] ?? '');
      if (command === 'execute') {
        const row = ledger.get(id);
        if (!row) throw new Error('Operation not found');
        const op = JSON.parse(row.body) as { evidenceIds: string[] };
        const evidence = snapshot.evidence.filter((e) =>
          op.evidenceIds.includes(e.id),
        );
        await ledger.execute(id, evidence, ledger.snapshotExecutor());
      }
      if (command === 'reconcile')
        await ledger.reconcile(id, ledger.snapshotExecutor());
      console.log(JSON.stringify(ledger.get(id), null, 2));
    } finally {
      ledger.close();
    }
  } else if (command === 'query') {
    const source = new SnapshotSource(snapshot);
    console.log(
      JSON.stringify(
        await source.query('inventory', {
          sku: snapshot.evidence[0]!.sku,
          window: snapshot.evidence[0]!.window,
        }),
      ),
    );
  } else throw new Error(`Unsupported command: ${command}`);
} finally {
  await shutdownCommerceTracing();
}
