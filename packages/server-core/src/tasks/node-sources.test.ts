import { describe, it, expect } from 'bun:test';
import { parseTaskSpec } from '@orbit-agents/shared/tasks';

describe('task node source boundary', () => {
  it('accepts subsets and explicit empty source sets', () => {
    const parsed = parseTaskSpec({ id: 'scope', title: 'Scope', goal: 'review', sources: ['read'],
      nodes: [{ id: 'a', prompt: 'read', sources: ['read'] }, { id: 'b', prompt: 'summarize', sources: [] }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.nodes[1]!.sources).toEqual([]);
  });
  it('rejects source escalation outside the task allowlist', () => {
    const parsed = parseTaskSpec({ id: 'scope', title: 'Scope', goal: 'review', sources: ['read'],
      nodes: [{ id: 'a', prompt: 'read', sources: ['write'] }] });
    expect(parsed.success).toBe(false);
  });
});
