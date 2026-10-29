// /api/v1/sites/{slug}/refs/{snapshot}/{row}/{col}: packages/contracts' ref; every other method is the one 404.
import { preflight } from "../../../../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../../../../lib/api/pipeline.ts";
import { ref } from "../../../../../../../../../lib/api/routes.ts";

export const GET = ref;
export const POST = unknownRoute;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
