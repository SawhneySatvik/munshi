import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { envPresence } from '../../../../packages/config/src/index.ts';

it('reports only names and set or unset, never a planted value', () => {
  const planted = `secret-${randomUUID()}`;
  const output = envPresence(['GEMINI_API_KEY', 'OPENAI_API_KEY'], {
    GEMINI_API_KEY: planted,
    OPENAI_API_KEY: '',
  });
  expect(output).toBe('GEMINI_API_KEY: set\nOPENAI_API_KEY: unset');
  expect(output).not.toContain(planted);
});
