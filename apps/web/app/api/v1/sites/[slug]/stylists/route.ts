// /api/v1/sites/{slug}/stylists: packages/contracts' stylists; every other method is the one 404.
import { preflight } from "../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../lib/api/pipeline.ts";
import { stylists } from "../../../../../../lib/api/routes.ts";

export const GET = stylists;
export const POST = unknownRoute;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
