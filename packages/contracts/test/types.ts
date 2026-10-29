// Compile-time gates (tsc, not vitest, which strips types; test/types.test.ts runs tsc over this file and red-proves it).
// The SDK's generated types equal the zod-inferred types exactly, both ways, for every component and every route; and a
// figure cannot be written as a bare number or without its ref, on either side.
import type { z } from 'zod';
import type * as Sdk from '../../sdk/src/schema.gen.ts';
import type { MoneyFigure, routes, schemas } from '../src/index.ts';

// Identity, not mutual assignability: an optional field more or less on either side fails it.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
// The names of the entries that differ, or never.
type Differing<A, B> = { [K in keyof A & keyof B]: Equal<A[K], B[K]> extends true ? never : K }[keyof A & keyof B];

type Zod = { [K in keyof typeof schemas]: z.output<(typeof schemas)[K]> };
export const sameComponentNames: Equal<keyof Sdk.Schemas, keyof Zod> = true;
export const sameComponents: [Differing<Sdk.Schemas, Zod>] extends [never] ? true : Differing<Sdk.Schemas, Zod> = true;
export const sameComponentMap: Equal<Sdk.Schemas, Zod> = true;

type R = typeof routes;
type Part<S> = S extends z.ZodType ? z.output<S> : S extends string ? ArrayBuffer : undefined;
type RouteTypes = {
  [K in keyof R]: {
    method: R[K]['method'];
    path: R[K]['path'];
    auth: R[K]['auth'];
    params: Part<R[K]['params']>;
    query: Part<R[K]['query']>;
    headers: Part<R[K]['headers']>;
    body: Part<R[K]['body']>;
    status: R[K]['status'];
    response: Part<R[K]['response']>;
    deferred: R[K]['deferred'];
  };
};
export const sameOperationNames: Equal<keyof Sdk.Operations, keyof RouteTypes> = true;
export const sameOperations: [Differing<Sdk.Operations, RouteTypes>] extends [never] ? true : Differing<Sdk.Operations, RouteTypes> = true;

// A figure is a cell with its ref (guarantee clause 2): none of these may compile.
// @ts-expect-error a bare number where a price goes
export const barePrice: Sdk.Service['price'] = 800;
// @ts-expect-error a figure whose ref is null
export const nullRef: Sdk.MoneyFigure = { minor: 80_000, currency: 'INR', ref: null };
// @ts-expect-error a figure with no ref
export const noRef: Sdk.MoneyFigure = { minor: 80_000, currency: 'INR' };
// @ts-expect-error a derived total with no refs to derive from
export const noSource: Sdk.OrderCreated['total'] = { minor: 80_000, currency: 'INR' };
// @ts-expect-error the zod side refuses the same
export const zodNoRef: z.output<typeof MoneyFigure> = { minor: 80_000, currency: 'INR' };
