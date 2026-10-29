// /api/v1/sites/{slug}/orders/{code}: packages/contracts' orderStatus; every other method is the one 404.
import { preflight } from "../../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../../lib/api/pipeline.ts";
import { orderStatus } from "../../../../../../../lib/api/routes.ts";

export const GET = orderStatus;
export const POST = unknownRoute;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
