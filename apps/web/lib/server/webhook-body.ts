// A webhook's raw body, read only up to `max` bytes: a Content-Length over the cap (or not a number) is refused before
// anything is read, and a body that runs past the cap as it streams (no length given, or a false one) is cut off there.
// Null is a refusal; the routes answer it as they answer a bad signature.
import "server-only";
export async function readCapped(request: Request, max: number): Promise<Buffer | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]{1,15}$/.test(length) || Number(length) > max)) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
