import { readFileSync } from 'node:fs';
import {
  DomainError,
  EvidenceSchema,
  QuerySchema,
  SnapshotSchema,
  KINDS,
  type Evidence,
  type EvidenceKind,
  type Query,
  type Snapshot,
} from './contracts.js';
import { readBoundedJson } from './http.js';

export interface EvidenceSource {
  query(
    kind: EvidenceKind,
    query: Query,
    signal?: AbortSignal,
  ): Promise<Evidence[]>;
}
export function loadSnapshot(file: string): Snapshot {
  return SnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}
export class SnapshotSource implements EvidenceSource {
  constructor(readonly snapshot: Snapshot) {}
  async query(kind: EvidenceKind, raw: Query): Promise<Evidence[]> {
    const query = QuerySchema.parse(raw);
    const found = this.snapshot.evidence.filter(
      (e) =>
        e.kind === kind &&
        this.snapshot.skuMap[`${e.sourceId}:${e.sourceSku}`] === query.sku &&
        e.window.start === query.window.start &&
        e.window.end === query.window.end,
    );
    if (!found.length)
      throw new DomainError(
        'missing_evidence',
        `No comparable ${kind} evidence for ${query.sku}`,
      );
    return structuredClone(
      found.map((e) => {
        if (e.sku !== query.sku) throw new DomainError('sku_mismatch', e.id);
        return e;
      }),
    );
  }
}

/** The remote API must implement this canonical contract; vendor mapping stays at its edge. */
export class ApiSource implements EvidenceSource {
  constructor(
    private readonly baseUrl: URL,
    private readonly token: string,
    private readonly timeoutMs = 10_000,
  ) {
    if (
      baseUrl.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)
    )
      throw new DomainError('unsafe_source', 'Remote API requires HTTPS');
  }
  async query(
    kind: EvidenceKind,
    raw: Query,
    signal?: AbortSignal,
  ): Promise<Evidence[]> {
    const query = QuerySchema.parse(raw);
    const url = new URL(
      `evidence/${kind}`,
      this.baseUrl.href.replace(/\/?$/, '/'),
    );
    url.search = new URLSearchParams({
      sku: query.sku,
      start: query.window.start,
      end: query.window.end,
    }).toString();
    const response = await fetch(url, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.any([
        AbortSignal.timeout(this.timeoutMs),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!response.ok)
      throw new DomainError(
        'source_error',
        `Evidence API returned ${response.status}`,
      );
    const evidence = EvidenceSchema.array().parse(
      await readBoundedJson(response),
    );
    if (
      !evidence.length ||
      evidence.some(
        (e) =>
          e.kind !== kind ||
          e.sku !== query.sku ||
          e.window.start !== query.window.start ||
          e.window.end !== query.window.end,
      )
    )
      throw new DomainError(
        'incomparable_evidence',
        'API returned a different SKU, kind or window',
      );
    return evidence;
  }
}

export function validateEvidence(
  evidence: Evidence[],
  now: Date,
  maxAgeMs = 86_400_000,
): string[] {
  const reasons: string[] = [];
  if (new Set(evidence.map((e) => e.currency)).size > 1)
    reasons.push('currency_mismatch');
  if (new Set(evidence.map((e) => e.sku)).size > 1)
    reasons.push('sku_mismatch');
  if (
    new Set(evidence.map((e) => `${e.window.start}/${e.window.end}`)).size > 1
  )
    reasons.push('window_mismatch');
  if (new Set(evidence.map((e) => e.snapshotId)).size > 1)
    reasons.push('snapshot_mismatch');
  if (new Set(evidence.map((e) => e.id)).size !== evidence.length)
    reasons.push('duplicate_evidence');
  for (const kind of KINDS)
    if (
      new Set(
        evidence.filter((e) => e.kind === kind).map((e) => e.metricDefinition),
      ).size > 1
    )
      reasons.push(`metric_definition_mismatch:${kind}`);
  for (const e of evidence) {
    const age = now.getTime() - Date.parse(e.observedAt);
    if (e.status !== 'valid' || age > maxAgeMs || age < 0)
      reasons.push(`stale_or_unavailable:${e.id}`);
    if (
      Date.parse(e.retrievedAt) < Date.parse(e.observedAt) ||
      Date.parse(e.retrievedAt) > now.getTime()
    )
      reasons.push(`invalid_timestamp:${e.id}`);
  }
  return reasons;
}
