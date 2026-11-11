import type { Evidence } from './contracts.js';

export type Anomaly = {
  kind: 'stockout' | 'order_drop' | 'promotion_conflict';
  evidenceIds: string[];
  description: string;
};
/** Deterministic detection proposes investigation; it never proves a causal explanation. */
export function detectAnomalies(rows: Evidence[]): Anomaly[] {
  const result: Anomaly[] = [];
  for (const e of rows) {
    if (e.kind === 'inventory' && e.values['availableUnits'] === 0)
      result.push({
        kind: 'stockout',
        evidenceIds: [e.id],
        description: 'Sellable inventory is zero at the observation timestamp.',
      });
    if (e.kind === 'orders') {
      const paid = e.values['paidOrders'];
      const baseline = e.values['baselinePaidOrders'];
      if (
        typeof paid === 'number' &&
        typeof baseline === 'number' &&
        baseline > 0 &&
        paid < baseline * 0.7
      )
        result.push({
          kind: 'order_drop',
          evidenceIds: [e.id],
          description: `Paid orders ${paid} are below the comparable baseline ${baseline}.`,
        });
    }
    if (
      e.kind === 'promotions' &&
      e.values['active'] === true &&
      e.values['stackable'] === false
    )
      result.push({
        kind: 'promotion_conflict',
        evidenceIds: [e.id],
        description:
          'An active non-stackable promotion prevents an additional price change.',
      });
  }
  return result;
}
