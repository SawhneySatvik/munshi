// GET /api/health: what the deploy check and the capture guard read. Boot's own result, labels and
// the schema sha's first 12 hex characters only: no secret, no URL, no count. A refusal answers 503 with its code.
import { boot, refusal } from "../../../lib/server/db.ts";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, ...(await boot()) }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ ok: false, code: refusal(err).code }, { status: 503, headers: NO_STORE });
  }
}
