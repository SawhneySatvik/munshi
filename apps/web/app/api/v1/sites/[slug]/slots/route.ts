// /api/v1/sites/{slug}/slots: packages/contracts' slots; every other method is the one 404.
import { preflight } from "../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../lib/api/pipeline.ts";
import { slots } from "../../../../../../lib/api/routes.ts";

export const GET = slots;
export const POST = unknownRoute;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
