import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export type TraceEvent = {
  id: string;
  runId: string;
  sessionId: string;
  at: string;
  type: 'tool' | 'review' | 'approval' | 'error' | 'complete' | 'generation';
  tool?: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  parentId?: string;
};
const secret = /key|token|authorization|password|secret|cookie/i;
const usageMetrics = new Set([
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
]);
let sharedProvider: NodeTracerProvider | undefined;
export async function shutdownCommerceTracing(): Promise<void> {
  await sharedProvider?.shutdown();
  sharedProvider = undefined;
}
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth limit]';
  if (typeof value === 'string') return value.slice(0, 12_000);
  if (Array.isArray(value))
    return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        secret.test(k) && !usageMetrics.has(k)
          ? '[REDACTED]'
          : redact(v, depth + 1),
      ]),
    );
  return value;
}
export class TraceRecorder {
  readonly events: TraceEvent[] = [];
  private provider: NodeTracerProvider | undefined;
  constructor(
    readonly runId: string,
    readonly sessionId: string,
    private readonly file?: string,
  ) {
    if (file) mkdirSync(dirname(file), { recursive: true });
  }
  enableLangfuse(): void {
    if (
      this.provider ||
      !process.env['LANGFUSE_PUBLIC_KEY'] ||
      !process.env['LANGFUSE_SECRET_KEY']
    )
      return;
    if (!sharedProvider) {
      sharedProvider = new NodeTracerProvider({
        spanProcessors: [new LangfuseSpanProcessor()],
      });
      sharedProvider.register();
    }
    this.provider = sharedProvider;
  }
  record(
    event: Omit<TraceEvent, 'id' | 'runId' | 'sessionId' | 'at'>,
  ): TraceEvent {
    const row = redact({
      ...event,
      id: randomUUID(),
      runId: this.runId,
      sessionId: this.sessionId,
      at: new Date().toISOString(),
    }) as TraceEvent;
    this.events.push(row);
    if (this.file)
      appendFileSync(this.file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    return row;
  }
  async observe<T>(
    name: string,
    input: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    const begin = performance.now();
    const run = async (): Promise<T> => {
      try {
        const output = await fn();
        this.record({
          type: 'tool',
          tool: name,
          input,
          output,
          durationMs: performance.now() - begin,
        });
        return output;
      } catch (error) {
        this.record({
          type: 'error',
          tool: name,
          input,
          output: {
            message: error instanceof Error ? error.message : String(error),
          },
          durationMs: performance.now() - begin,
        });
        throw error;
      }
    };
    if (!this.provider) return run();
    return propagateAttributes(
      { sessionId: this.sessionId, traceName: this.runId },
      () =>
        startActiveObservation(
          name,
          async (span) => {
            span.update({ input: redact(input) });
            const output = await run();
            span.update({ output: redact(output) });
            return output;
          },
          { asType: 'tool' },
        ),
    );
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.provider) return fn();
    return propagateAttributes(
      { sessionId: this.sessionId, traceName: this.runId },
      () =>
        startActiveObservation('commerce-investigation', async () => fn(), {
          asType: 'agent',
        }),
    );
  }
  async shutdown(): Promise<void> {
    await this.provider?.forceFlush();
  }
}
