// /api/v1/sites/{slug}/holds: packages/contracts' hold; every other method is the one 404.
import { preflight } from "../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../lib/api/pipeline.ts";
import { hold } from "../../../../../../lib/api/routes.ts";

export const GET = unknownRoute;
export const POST = hold;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
