import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  digest,
  DomainError,
  KINDS,
  OperationSchema,
  QuerySchema,
  ReportSchema,
  type Evidence,
  type Role,
} from './contracts.js';
import { type EvidenceSource } from './sources.js';
import { OperationLedger, type OperationExecutor } from './ledger.js';
import { reviewReport } from './policy.js';
import { TraceRecorder } from './trace.js';

export const ROLE_TOOLS: Record<Role, readonly string[]> = {
  catalog: ['query_catalog', 'query_orders', 'query_sales', 'query_promotions'],
  inventory: ['query_inventory', 'query_orders'],
  ads: ['query_ads', 'query_sales'],
  reviewer: [...KINDS.map((k) => `query_${k}`), 'review_report'],
  coordinator: [
    ...KINDS.map((k) => `query_${k}`),
    'review_report',
    'request_operation',
    'operation_status',
    'execute_operation',
    'reconcile_operation',
  ],
};
export const IdSchema = z.object({ operationId: z.string().min(1).max(128) });
export const ReviewSchema = z.object({
  report: ReportSchema,
  evidenceIds: z.array(z.string()).min(1),
});
export class CommerceTools {
  constructor(
    readonly role: Role,
    private readonly source: EvidenceSource,
    readonly ledger: OperationLedger,
    readonly trace: TraceRecorder,
    private readonly now: () => Date,
    private readonly artifactDir: string,
    private readonly executor: OperationExecutor = ledger.snapshotExecutor(),
  ) {
    ledger.db.exec(
      'CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL)',
    );
  }
  evidence(ids: string[]): Evidence[] {
    return [...new Set(ids)].map((id) => {
      const row = this.ledger.db
        .prepare('SELECT body FROM evidence WHERE id=?')
        .get(id) as { body: string } | undefined;
      if (!row) throw new DomainError('evidence_not_collected', id);
      return JSON.parse(row.body) as Evidence;
    });
  }
  private remember(rows: Evidence[]): void {
    this.ledger.db.transaction(() => {
      for (const e of rows) {
        const prior = this.ledger.db
          .prepare('SELECT hash FROM evidence WHERE id=?')
          .get(e.id) as { hash: string } | undefined;
        if (prior && prior.hash !== digest(e))
          throw new DomainError('immutable_evidence_conflict', e.id);
        this.ledger.db
          .prepare('INSERT OR IGNORE INTO evidence VALUES (?,?,?)')
          .run(e.id, digest(e), JSON.stringify(e));
      }
    })();
  }
  async call(name: string, input: unknown): Promise<unknown> {
    if (!ROLE_TOOLS[this.role].includes(name))
      throw new DomainError('forbidden_tool', `${this.role}:${name}`);
    return this.trace.observe(name, input, async () => {
      const kind = KINDS.find((k) => name === `query_${k}`);
      if (kind) {
        const rows = await this.source.query(kind, QuerySchema.parse(input));
        this.remember(rows);
        const text = JSON.stringify(rows);
        if (text.length <= 12_000) return rows;
        mkdirSync(this.artifactDir, { recursive: true });
        const file = join(this.artifactDir, `${digest(rows)}.json`);
        writeFileSync(file, text, { mode: 0o600 });
        return {
          evidenceIds: rows.map((e) => e.id),
          count: rows.length,
          rawRef: file,
          summary: text.slice(0, 2000),
          truncated: true,
        };
      }
      if (name === 'review_report') {
        const args = ReviewSchema.parse(input);
        const verdict = reviewReport(
          args.report,
          this.evidence(args.evidenceIds),
          this.now(),
        );
        this.trace.record({ type: 'review', output: verdict });
        return verdict;
      }
      if (name === 'request_operation') {
        const op = OperationSchema.parse(input);
        const row = this.ledger.request(op, this.evidence(op.evidenceIds));
        this.trace.record({
          type: 'approval',
          output: { operationId: row.id, hash: row.hash, status: row.status },
        });
        return { operationId: row.id, hash: row.hash, status: row.status };
      }
      const { operationId } = IdSchema.parse(input);
      if (name === 'operation_status')
        return this.ledger.get(operationId) ?? null;
      if (name === 'reconcile_operation')
        return this.ledger.reconcile(operationId, this.executor);
      if (name === 'execute_operation') {
        const row = this.ledger.get(operationId);
        if (!row) throw new DomainError('operation_missing', operationId);
        const op = OperationSchema.parse(JSON.parse(row.body));
        if (row.approved_by)
          this.trace.record({
            type: 'approval',
            output: {
              operationId,
              status: 'approved',
              actor: row.approved_by,
              hash: row.hash,
            },
          });
        return this.ledger.execute(
          operationId,
          this.evidence(op.evidenceIds),
          this.executor,
        );
      }
      throw new DomainError('unknown_tool', name);
    });
  }
}
