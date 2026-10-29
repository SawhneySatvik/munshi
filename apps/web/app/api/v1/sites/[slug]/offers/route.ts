// /api/v1/sites/{slug}/offers: packages/contracts' offers; every other method is the one 404.
import { preflight } from "../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../lib/api/pipeline.ts";
import { offers } from "../../../../../../lib/api/routes.ts";

export const GET = offers;
export const POST = unknownRoute;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
