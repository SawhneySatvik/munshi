// Every v1 schema under its export name: the OpenAPI components and the SDK's types. A registry local to the contracts
// (not zod's global one), so nothing outside this package can add a component.
import { z } from 'zod';
import * as bookings from './bookings.ts';
import * as catalogue from './catalogue.ts';
import * as common from './common.ts';
import * as developer from './developer.ts';
import * as holds from './holds.ts';
import * as media from './media.ts';
import * as offers from './offers.ts';
import * as orders from './orders.ts';
import * as packages from './packages.ts';
import * as refs from './refs.ts';
import * as requests from './requests.ts';
import * as reservations from './reservations.ts';
import * as services from './services.ts';
import * as site from './site.ts';
import * as slots from './slots.ts';
import * as stylists from './stylists.ts';

const modules = [common, site, catalogue, services, packages, offers, stylists, slots, media, refs, holds, bookings, requests, reservations, orders, developer];

export const schemas = {
  ...common,
  ...site,
  ...catalogue,
  ...services,
  ...packages,
  ...offers,
  ...stylists,
  ...slots,
  ...media,
  ...refs,
  ...holds,
  ...bookings,
  ...requests,
  ...reservations,
  ...orders,
  ...developer,
};
export type SchemaId = keyof typeof schemas;

export const registry = z.registry<{ id: string }>();
for (const [id, schema] of Object.entries(schemas)) {
  if (!(schema instanceof z.ZodType)) throw new Error(`contracts: ${id} is exported from a schema module but is not a schema`);
  registry.add(schema, { id });
}
// A name exported by two modules would silently keep only the last.
const exported = modules.reduce((n, m) => n + Object.keys(m).length, 0);
if (exported !== Object.keys(schemas).length) throw new Error('contracts: two schema modules export the same name');

export function idOf(schema: z.ZodType): string {
  const id = registry.get(schema)?.id;
  if (!id) throw new Error('contracts: a route names a schema that is not a registered component');
  return id;
}
