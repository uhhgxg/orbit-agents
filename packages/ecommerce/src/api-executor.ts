import { z } from 'zod';
import type { OperationExecutor } from './ledger.js';
import { DomainError, type Operation } from './contracts.js';
import { readBoundedJson } from './http.js';

const ReceiptSchema = z.object({
  operationId: z.string(),
  status: z.enum(['succeeded', 'pending', 'failed']),
  receipt: z.string().optional(),
});
/** Contract adapter: the upstream MUST honor idempotency and If-Match snapshot preconditions. */
export class ApiOperationExecutor implements OperationExecutor {
  constructor(
    private readonly base: URL,
    private readonly token: string,
  ) {
    if (
      base.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    )
      throw new Error('Remote operation API requires HTTPS');
  }
  async execute(
    op: Operation,
    signal?: AbortSignal,
  ): Promise<{ receipt: string }> {
    const response = await fetch(
      new URL('operations', this.base.href.replace(/\/?$/, '/')),
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': op.operationId,
          'If-Match': op.snapshotId,
        },
        body: JSON.stringify(op),
        signal: AbortSignal.any([
          AbortSignal.timeout(30_000),
          ...(signal ? [signal] : []),
        ]),
      },
    );
    if (!response.ok)
      throw new DomainError(
        'external_operation_error',
        `HTTP ${response.status}; reconcile required`,
      );
    const receipt = ReceiptSchema.parse(await readBoundedJson(response));
    if (
      receipt.operationId !== op.operationId ||
      receipt.status !== 'succeeded' ||
      !receipt.receipt
    )
      throw new DomainError('external_result_unknown', op.operationId);
    return { receipt: receipt.receipt };
  }
  async reconcile(id: string): Promise<{ receipt: string } | null> {
    const response = await fetch(
      new URL(
        `operations/${encodeURIComponent(id)}`,
        this.base.href.replace(/\/?$/, '/'),
      ),
      {
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Reconciliation returned HTTP ${response.status}`);
    const result = ReceiptSchema.parse(await readBoundedJson(response));
    return result.operationId === id &&
      result.status === 'succeeded' &&
      result.receipt
      ? { receipt: result.receipt }
      : null;
  }
}
