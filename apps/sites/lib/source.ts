// The data source. Today it reads the business's illustrative fixture; MS-29 replaces these bodies with @munshi/sdk
// calls (site(), services(), packages(), offers(), catalogue()). The fixture types (lib/types.ts) also carry fields
// §5.2 does not define yet, proposed as additive v1 fields: Site.sample, Service.from, Plan.kind, every row's `hi`
// label (Shop.hi too), Offer.appliesTo and variant attrs.swatch. MS-29 adds them to the API or drops their uses.
// Server-only: the fixture must not reach a client bundle.
import business from "@business";
import type { Offer, Plan, Product, Service, Site } from "./types.ts";

export async function site(): Promise<Site> {
  return business.data.site;
}

export async function services(): Promise<Service[]> {
  return business.data.services;
}

export async function packages(): Promise<Plan[]> {
  return business.data.packages;
}

export async function offers(): Promise<Offer[]> {
  return business.data.offers;
}

export async function catalogue(category?: string): Promise<Product[]> {
  return category ? business.data.catalogue.filter((p) => p.category === category) : business.data.catalogue;
}
