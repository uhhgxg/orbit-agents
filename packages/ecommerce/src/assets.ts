import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function fixturePath(): string {
  for (const relative of [
    '../fixtures/operations.json',
    '../../fixtures/operations.json',
  ]) {
    const file = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(file)) return file;
  }
  throw new Error('Cannot locate packaged operations snapshot');
}
