import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { digest, type Snapshot, type Operation } from './contracts.js';
import { replay } from './replay.js';
import { checkOperation } from './policy.js';
import { detectAnomalies } from './monitor.js';

export async function benchmark(base: Snapshot, state: string) {
  const cases = [
    {
      id: 'inventory-anomaly',
      expected: 'stockout',
      mutate: (_s: Snapshot) => {},
    },
    {
      id: 'order-volatility',
      expected: 'order_drop',
      mutate: (s: Snapshot) => {
        s.evidence.find((e) => e.kind === 'inventory')!.values[
          'availableUnits'
        ] = 200;
      },
    },
    {
      id: 'promotion-conflict',
      expected: 'promotion_conflict',
      mutate: (s: Snapshot) => {
        s.evidence.find((e) => e.kind === 'promotions')!.values['active'] =
          true;
      },
    },
  ];
  const results = [];
  for (const test of cases) {
    const snapshot = structuredClone(base);
    test.mutate(snapshot);
    const version = digest(snapshot).slice(0, 16);
    snapshot.id = `${base.id}:${test.id}:${version}`;
    const directory = join(state, test.id, version);
    mkdirSync(directory, { recursive: true });
    const snapshotFile = join(directory, 'snapshot.json');
    for (const evidence of snapshot.evidence) {
      evidence.snapshotId = snapshot.id;
      evidence.id = `${snapshot.id}/${evidence.id}`;
      evidence.rawRef = `${snapshotFile}#${encodeURIComponent(evidence.id)}`;
    }
    const serialized = JSON.stringify(snapshot, null, 2);
    if (existsSync(snapshotFile)) {
      if (readFileSync(snapshotFile, 'utf8') !== serialized)
        throw new Error('Immutable benchmark snapshot was changed');
    } else writeFileSync(snapshotFile, serialized, { flag: 'wx' });
    const run = await replay(snapshot, directory);
    const detected = detectAnomalies(snapshot.evidence).some(
      (a) => a.kind === test.expected,
    );
    const operation: Operation = {
      operationId: `benchmark_${test.id}`,
      sku: snapshot.evidence[0]!.sku,
      snapshotId: snapshot.id,
      currency: snapshot.currency,
      action: 'change_price',
      amountMinor: 12000,
      evidenceIds: snapshot.evidence.map((e) => e.id),
    };
    const policy = checkOperation(
      operation,
      snapshot.evidence,
      new Date(snapshot.asOf),
    );
    const policyCorrect =
      test.id === 'promotion-conflict'
        ? policy.reasons.includes('promotion_conflict')
        : policy.status === 'human_review';
    results.push({
      id: test.id,
      mode: 'deterministic-replay',
      passed: run.evaluation.passed && detected && policyCorrect,
      expectedAnomaly: test.expected,
      snapshotId: snapshot.id,
      snapshotFile,
      detected,
      policy,
      traceChecks: run.evaluation,
    });
  }
  return results;
}
