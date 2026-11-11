import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  type InvestigationReport,
  type Query,
  type Role,
  type Snapshot,
} from './contracts.js';
import { OperationLedger } from './ledger.js';
import { SnapshotSource } from './sources.js';
import { TraceRecorder } from './trace.js';
import { CommerceTools } from './tools.js';
import { scoreTrace, type EvalResult } from './eval.js';
import { detectAnomalies } from './monitor.js';

/** Deterministic tool replay for regression. Real LLM orchestration uses the supplied task.yaml. */
export async function replay(
  snapshot: Snapshot,
  state: string,
): Promise<{
  report: InvestigationReport;
  evaluation: EvalResult;
  events: TraceRecorder['events'];
}> {
  const now = () => new Date(snapshot.asOf);
  const ledger = new OperationLedger(
    join(state, 'operations.sqlite'),
    () => new Date(),
    now,
  );
  const trace = new TraceRecorder(
    randomUUID(),
    'commerce-replay',
    join(state, 'trace.jsonl'),
  );
  trace.enableLangfuse();
  const source = new SnapshotSource(snapshot);
  const make = (role: Role) =>
    new CommerceTools(
      role,
      source,
      ledger,
      trace,
      now,
      join(state, 'artifacts'),
    );
  const first = snapshot.evidence[0];
  if (!first) throw new Error('Snapshot has no evidence');
  const query: Query = { sku: first.sku, window: first.window };
  try {
    return await trace.run(async () => {
      await trace.observe(
        'investigation',
        { snapshotId: snapshot.id, mode: 'deterministic-replay' },
        async () => {
          const jobs: Array<[Role, string[]]> = [
            [
              'catalog',
              [
                'query_catalog',
                'query_orders',
                'query_sales',
                'query_promotions',
              ],
            ],
            ['inventory', ['query_inventory']],
            ['ads', ['query_ads']],
          ];
          const result = await Promise.allSettled(
            jobs.map(async ([role, tools]) => {
              const worker = make(role);
              for (const name of tools) await worker.call(name, query);
            }),
          );
          if (result.some((r) => r.status === 'rejected'))
            throw new Error(
              'Partial evidence failure; requires supplemental investigation',
            );
        },
      );
      const report: InvestigationReport = {
        summary:
          'Order decline requires joint inventory and promotion investigation; correlation alone does not establish causation.',
        evidenceIds: snapshot.evidence.map((e) => e.id),
        conclusions: detectAnomalies(snapshot.evidence).map((a) => ({
          claim: a.description,
          evidenceIds: a.evidenceIds,
        })),
        uncertainties: [
          'No time-series or counterfactual evidence establishes the sole cause of the decline.',
        ],
      };
      const coordinator = make('coordinator');
      await make('reviewer').call('review_report', {
        report,
        evidenceIds: report.evidenceIds,
      });
      const operation = {
        operationId: `replay_${randomUUID()}`,
        sku: query.sku,
        snapshotId: snapshot.id,
        currency: snapshot.currency,
        action: 'replenish',
        quantity: 20,
        evidenceIds: snapshot.evidence
          .filter((e) => ['catalog', 'inventory'].includes(e.kind))
          .map((e) => e.id),
      };
      await coordinator.call('request_operation', operation);
      // Stop at the human boundary. The demo never grants approval on the agent's behalf.
      trace.record({
        type: 'complete',
        output: {
          mode: 'replay',
          status: 'awaiting_human',
          operationId: operation.operationId,
        },
      });
      const evaluation = scoreTrace(
        {
          id: 'inventory-order-promotion',
          requiredTools: [
            'query_catalog',
            'query_orders',
            'query_sales',
            'query_inventory',
            'query_promotions',
            'query_ads',
            'review_report',
          ],
          expectedSku: query.sku,
          requiredEvidence: report.evidenceIds,
          before: [
            ['query_inventory', 'review_report'],
            ['review_report', 'request_operation'],
          ],
          requireApproval: true,
        },
        trace.events,
      );
      return { report, evaluation, events: trace.events };
    });
  } finally {
    await trace.shutdown();
    ledger.close();
  }
}
