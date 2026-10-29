// /api/v1/sites/{slug}/enquiries: packages/contracts' enquire; every other method is the one 404.
import { preflight } from "../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../lib/api/pipeline.ts";
import { enquire } from "../../../../../../lib/api/routes.ts";

export const GET = unknownRoute;
export const POST = enquire;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
