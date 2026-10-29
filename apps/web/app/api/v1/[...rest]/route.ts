// Every path under /api/v1 that no route serves, the deferred ones (/findings, /drafts) among them: the one 404, the
// same bytes an unknown slug, an unverified site or a malformed parameter answers.
import { unknownRoute } from "../../../../lib/api/pipeline.ts";

export const GET = unknownRoute;
export const POST = unknownRoute;
export const DELETE = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const OPTIONS = unknownRoute;
