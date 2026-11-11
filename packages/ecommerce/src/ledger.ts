import Database from 'better-sqlite3';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  digest,
  DomainError,
  OperationSchema,
  type Evidence,
  type Operation,
} from './contracts.js';
import { checkOperation } from './policy.js';

type Status =
  'pending' | 'approved' | 'executing' | 'succeeded' | 'unknown' | 'rejected';
export interface LedgerRow {
  id: string;
  hash: string;
  body: string;
  evidence_hash: string;
  status: Status;
  expires_at: string | null;
  approved_by: string | null;
  receipt: string | null;
}
export interface OperationExecutor {
  execute(
    operation: Operation,
    signal?: AbortSignal,
  ): Promise<{ receipt: string }>;
  reconcile(operationId: string): Promise<{ receipt: string } | null>;
}

export class OperationLedger {
  readonly db: Database.Database;
  constructor(
    file: string,
    private readonly now: () => Date = () => new Date(),
    private readonly evidenceNow: () => Date = now,
  ) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL, evidence_hash TEXT NOT NULL,
      status TEXT NOT NULL, expires_at TEXT, approved_by TEXT, receipt TEXT);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, at TEXT NOT NULL, event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_effects (operation_id TEXT PRIMARY KEY, sku TEXT NOT NULL, action TEXT NOT NULL, body TEXT NOT NULL);`);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS operator_config (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL)',
    );
  }
  close(): void {
    this.db.close();
  }
  configureOperator(token: string): void {
    if (token.length < 32)
      throw new DomainError(
        'weak_operator_token',
        'Use at least 32 random characters',
      );
    this.db
      .prepare('INSERT INTO operator_config VALUES (1,?)')
      .run(digest(token));
  }
  authorizeOperator(token: string): void {
    const row = this.db
      .prepare('SELECT token_hash FROM operator_config WHERE id=1')
      .get() as { token_hash: string } | undefined;
    if (
      !row ||
      !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(digest(token)))
    )
      throw new DomainError(
        'operator_auth_required',
        'Invalid operator credential',
      );
  }
  get(id: string): LedgerRow | undefined {
    return this.db.prepare('SELECT * FROM operations WHERE id = ?').get(id) as
      LedgerRow | undefined;
  }
  private audit(id: string, event: string): void {
    this.db
      .prepare('INSERT INTO audit VALUES (?, ?, ?, ?)')
      .run(randomUUID(), id, this.now().toISOString(), event);
  }
  request(raw: Operation, evidence: Evidence[]): LedgerRow {
    const op = OperationSchema.parse(raw);
    const verdict = checkOperation(op, evidence, this.evidenceNow());
    if (verdict.status === 'blocked')
      throw new DomainError('operation_blocked', verdict.reasons.join(','));
    const hash = digest(op);
    const evidenceHash = digest(
      evidence.filter((e) => op.evidenceIds.includes(e.id)),
    );
    return this.db.transaction(() => {
      const existing = this.get(op.operationId);
      if (existing) {
        if (existing.hash !== hash || existing.evidence_hash !== evidenceHash)
          throw new DomainError('idempotency_conflict', op.operationId);
        return existing;
      }
      this.db
        .prepare(
          'INSERT INTO operations (id,hash,body,evidence_hash,status) VALUES (?,?,?,?,?)',
        )
        .run(op.operationId, hash, JSON.stringify(op), evidenceHash, 'pending');
      this.audit(op.operationId, 'requested');
      return this.get(op.operationId)!;
    })();
  }
  /** Trusted human/operator boundary. Deliberately absent from MCP tool registration. */
  approve(
    id: string,
    expectedHash: string,
    actor: string,
    ttlMs = 300_000,
  ): void {
    if (
      !actor.trim() ||
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > 3_600_000
    )
      throw new DomainError('invalid_approval', id);
    this.db.transaction(() => {
      const row = this.get(id);
      if (!row || row.hash !== expectedHash || row.status !== 'pending')
        throw new DomainError('approval_conflict', id);
      this.db
        .prepare(
          "UPDATE operations SET status='approved',approved_by=?,expires_at=? WHERE id=?",
        )
        .run(actor, new Date(this.now().getTime() + ttlMs).toISOString(), id);
      this.audit(id, `approved:${actor}`);
    })();
  }
  reject(id: string): void {
    const changed = this.db
      .prepare(
        "UPDATE operations SET status='rejected' WHERE id=? AND status IN ('pending','approved')",
      )
      .run(id).changes;
    if (changed) this.audit(id, 'rejected');
  }
  async execute(
    id: string,
    evidence: Evidence[],
    executor: OperationExecutor,
  ): Promise<LedgerRow> {
    const claimed = this.db.transaction(() => {
      const row = this.get(id);
      if (!row) throw new DomainError('operation_missing', id);
      if (row.status === 'succeeded') return { row, claimed: false };
      if (row.status !== 'approved')
        throw new DomainError('approval_required_or_uncertain', row.status);
      if (!row.expires_at || Date.parse(row.expires_at) <= this.now().getTime())
        throw new DomainError('approval_expired', id);
      const op = OperationSchema.parse(JSON.parse(row.body));
      const referenced = evidence.filter((e) => op.evidenceIds.includes(e.id));
      if (digest(referenced) !== row.evidence_hash)
        throw new DomainError('evidence_changed', id);
      const verdict = checkOperation(op, evidence, this.evidenceNow());
      if (verdict.status === 'blocked')
        throw new DomainError('policy_changed', verdict.reasons.join(','));
      this.db
        .prepare(
          "UPDATE operations SET status='executing' WHERE id=? AND status='approved'",
        )
        .run(id);
      this.audit(id, 'executing');
      return { row, claimed: true };
    })();
    if (!claimed.claimed) return claimed.row;
    try {
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error('Operation timed out; reconcile before retry'));
        }, 30_000);
      });
      let receipt: { receipt: string };
      try {
        receipt = await Promise.race([
          executor.execute(
            OperationSchema.parse(JSON.parse(claimed.row.body)),
            abort.signal,
          ),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
      this.db
        .prepare(
          "UPDATE operations SET status='succeeded',receipt=? WHERE id=? AND status='executing'",
        )
        .run(receipt.receipt, id);
      this.audit(id, 'succeeded');
    } catch (error) {
      this.db
        .prepare(
          "UPDATE operations SET status='unknown' WHERE id=? AND status='executing'",
        )
        .run(id);
      this.audit(id, 'result_unknown');
      throw new DomainError(
        'result_unknown',
        error instanceof Error ? error.message : String(error),
      );
    }
    return this.get(id)!;
  }
  async reconcile(id: string, executor: OperationExecutor): Promise<LedgerRow> {
    const row = this.get(id);
    if (!row || !['unknown', 'executing'].includes(row.status))
      throw new DomainError('not_uncertain', id);
    const receipt = await executor.reconcile(id);
    if (receipt) {
      this.db
        .prepare(
          "UPDATE operations SET status='succeeded',receipt=? WHERE id=? AND status IN ('executing','unknown')",
        )
        .run(receipt.receipt, id);
      this.audit(id, 'reconciled');
    }
    // An absent receipt is not evidence of failure: never reset to approved automatically.
    return this.get(id)!;
  }
  snapshotExecutor(): OperationExecutor {
    return {
      execute: async (op) => {
        this.db
          .prepare('INSERT OR IGNORE INTO snapshot_effects VALUES (?,?,?,?)')
          .run(op.operationId, op.sku, op.action, JSON.stringify(op));
        return { receipt: `snapshot:${op.operationId}` };
      },
      reconcile: async (id) =>
        this.db
          .prepare(
            'SELECT operation_id FROM snapshot_effects WHERE operation_id=?',
          )
          .get(id)
          ? { receipt: `snapshot:${id}` }
          : null,
    };
  }
}
