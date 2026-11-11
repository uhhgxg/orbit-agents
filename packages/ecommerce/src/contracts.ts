import { createHash } from 'node:crypto';
import { z } from 'zod';

export const KINDS = [
  'catalog',
  'inventory',
  'orders',
  'sales',
  'promotions',
  'ads',
] as const;
export type EvidenceKind = (typeof KINDS)[number];
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const WindowSchema = z
  .object({ start: z.iso.datetime(), end: z.iso.datetime() })
  .refine(
    (w) => Date.parse(w.start) < Date.parse(w.end),
    'window must be [start,end)',
  );
export const QuerySchema = z.object({
  sku: z.string().min(1).max(128),
  window: WindowSchema,
});
export type Query = z.infer<typeof QuerySchema>;
const EvidenceBase = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  snapshotId: z.string().min(1),
  sku: z.string().min(1),
  sourceSku: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  window: WindowSchema,
  observedAt: z.iso.datetime(),
  retrievedAt: z.iso.datetime(),
  status: z.enum(['valid', 'stale', 'unavailable']),
  metricDefinition: z.string().min(1),
  rawRef: z.string().min(1),
});
const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const EvidenceSchema = z.discriminatedUnion('kind', [
  EvidenceBase.extend({
    kind: z.literal('catalog'),
    values: z.object({
      active: z.boolean(),
      priceMinor: amount,
      costMinor: amount,
      minMarginBps: z.number().int().min(0).max(9999),
    }),
  }),
  EvidenceBase.extend({
    kind: z.literal('inventory'),
    values: z.object({ availableUnits: units, reservedUnits: units }),
  }),
  EvidenceBase.extend({
    kind: z.literal('orders'),
    values: z.object({
      paidOrders: units,
      baselinePaidOrders: units,
      cancelledOrders: units,
    }),
  }),
  EvidenceBase.extend({
    kind: z.literal('sales'),
    values: z.object({ netSalesMinor: amount }),
  }),
  EvidenceBase.extend({
    kind: z.literal('promotions'),
    values: z.object({
      active: z.boolean(),
      stackable: z.boolean(),
      discountBps: z.number().int().min(0).max(10000),
    }),
  }),
  EvidenceBase.extend({
    kind: z.literal('ads'),
    values: z.object({
      spendMinor: amount,
      budgetCeilingMinor: amount,
      clicks: units,
    }),
  }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;
export const SnapshotSchema = z.object({
  id: z.string().min(1),
  asOf: z.iso.datetime(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  skuMap: z.record(z.string(), z.string().min(1)),
  evidence: z.array(EvidenceSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const OperationSchema = z
  .object({
    operationId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
    sku: z.string().min(1),
    snapshotId: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    action: z.enum(['change_price', 'change_budget', 'replenish', 'delist']),
    amountMinor: amount.optional(),
    quantity: z.number().int().positive().max(1_000_000).optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((v, c) => {
    if (
      ['change_price', 'change_budget'].includes(v.action) &&
      v.amountMinor === undefined
    )
      c.addIssue({ code: 'custom', message: 'amountMinor is required' });
    if (v.action === 'replenish' && v.quantity === undefined)
      c.addIssue({ code: 'custom', message: 'quantity is required' });
  });
export type Operation = z.infer<typeof OperationSchema>;
export type Role = 'catalog' | 'inventory' | 'ads' | 'reviewer' | 'coordinator';
export type Verdict = {
  status: 'pass' | 'blocked' | 'needs_evidence' | 'human_review';
  reasons: string[];
};
export const ReportSchema = z.object({
  summary: z.string().min(1),
  evidenceIds: z.array(z.string()),
  conclusions: z.array(
    z.object({
      claim: z.string().min(1),
      evidenceIds: z.array(z.string()).min(1),
    }),
  ),
  uncertainties: z.array(z.string()),
});
export type InvestigationReport = z.infer<typeof ReportSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
