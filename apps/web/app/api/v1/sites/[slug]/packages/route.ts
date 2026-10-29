// /api/v1/sites/{slug}/packages: packages/contracts' packages; every other method is the one 404.
import { preflight } from "../../../../../../lib/api/http.ts";
import { unknownRoute } from "../../../../../../lib/api/pipeline.ts";
import { packages } from "../../../../../../lib/api/routes.ts";

export const GET = packages;
export const POST = unknownRoute;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = preflight;
