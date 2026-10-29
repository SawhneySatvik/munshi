// /api/v1/sites/{slug}/holds/{id}: packages/contracts' releaseHold; every other method is the one 404.
import { preflight } from "../../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../../lib/api/pipeline.ts";
import { releaseHold } from "../../../../../../../lib/api/routes.ts";

export const GET = unknownRoute;
export const POST = unknownRoute;
export const DELETE = releaseHold;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
