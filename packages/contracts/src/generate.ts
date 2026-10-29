// The two generated files as text, from the schemas alone (BLUEPRINT §5.6). The SDK's types are emitted from the JSON
// text itself, so they are exactly what openapi.json says. A response with a bare number cannot be generated.
import { bareNumbers } from './figures.ts';
import { buildOpenApi } from './openapi.ts';
import { emitTypes } from './typescript.ts';

export function generate(): { openapi: string; types: string } {
  const doc = buildOpenApi();
  const bare = bareNumbers(doc);
  if (bare.length) throw new Error(`contracts: a number in a response that is not a figure: ${bare.join('; ')}`);
  const openapi = `${JSON.stringify(doc, null, 2)}\n`;
  return { openapi, types: emitTypes(JSON.parse(openapi)) };
}
