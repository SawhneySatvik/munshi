// /api/v1/sites/{slug}/orders: packages/contracts' order; every other method is the one 404.
import { preflight } from "../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../lib/api/pipeline.ts";
import { order } from "../../../../../../lib/api/routes.ts";

export const GET = unknownRoute;
export const POST = order;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
