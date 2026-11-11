import {
  OperationSchema,
  type Evidence,
  type InvestigationReport,
  type Operation,
  type Verdict,
} from './contracts.js';
import { validateEvidence } from './sources.js';

export function reviewReport(
  report: InvestigationReport,
  evidence: Evidence[],
  now: Date,
): Verdict {
  const reasons = validateEvidence(evidence, now);
  const available = new Set(evidence.map((e) => e.id));
  for (const id of [
    ...report.evidenceIds,
    ...report.conclusions.flatMap((c) => c.evidenceIds),
  ])
    if (!available.has(id)) reasons.push(`unknown_evidence:${id}`);
  if (!report.conclusions.length) reasons.push('no_supported_conclusion');
  if (reasons.length)
    return { status: 'needs_evidence', reasons: [...new Set(reasons)] };
  if (report.uncertainties.length)
    return { status: 'human_review', reasons: report.uncertainties };
  return { status: 'pass', reasons: [] };
}

export function checkOperation(
  raw: Operation,
  evidence: Evidence[],
  now: Date,
): Verdict {
  const op = OperationSchema.parse(raw);
  const referenced = evidence.filter((e) => op.evidenceIds.includes(e.id));
  const reasons = validateEvidence(referenced, now);
  if (referenced.length !== new Set(op.evidenceIds).size)
    reasons.push('missing_evidence');
  if (
    referenced.some(
      (e) =>
        e.sku !== op.sku ||
        e.snapshotId !== op.snapshotId ||
        e.currency !== op.currency,
    )
  )
    reasons.push('operation_scope_mismatch');
  const catalog = referenced.find((e) => e.kind === 'catalog');
  const promo = referenced.filter((e) => e.kind === 'promotions');
  if (!catalog) reasons.push('catalog_evidence_required');
  if (catalog?.values['active'] !== true && op.action !== 'delist')
    reasons.push('sku_inactive');
  if (op.action === 'change_price') {
    if (!promo.length) reasons.push('promotion_evidence_required');
    if (
      promo.some(
        (e) => e.values['stackable'] === false && e.values['active'] === true,
      )
    )
      reasons.push('promotion_conflict');
    const cost = catalog?.values['costMinor'];
    const floor = catalog?.values['minMarginBps'];
    if (
      typeof cost !== 'number' ||
      typeof floor !== 'number' ||
      !Number.isSafeInteger(cost) ||
      !Number.isSafeInteger(floor) ||
      cost < 0 ||
      floor < 0 ||
      floor >= 10_000
    )
      reasons.push('invalid_margin_policy');
    else if (
      op.amountMinor === undefined ||
      op.amountMinor === 0 ||
      BigInt(op.amountMinor - cost) * 10_000n <
        BigInt(op.amountMinor) * BigInt(floor)
    )
      reasons.push('margin_floor');
  }
  if (op.action === 'change_budget') {
    const ads = referenced.find((e) => e.kind === 'ads');
    const ceiling = ads?.values['budgetCeilingMinor'];
    if (
      typeof ceiling !== 'number' ||
      !Number.isSafeInteger(ceiling) ||
      ceiling < 0
    )
      reasons.push('ads_policy_required');
    else if ((op.amountMinor ?? Infinity) > ceiling)
      reasons.push('budget_ceiling');
  }
  if (
    op.action === 'replenish' &&
    !referenced.some((e) => e.kind === 'inventory')
  )
    reasons.push('inventory_evidence_required');
  return reasons.length
    ? { status: 'blocked', reasons: [...new Set(reasons)] }
    : { status: 'human_review', reasons: ['explicit_approval_required'] };
}
