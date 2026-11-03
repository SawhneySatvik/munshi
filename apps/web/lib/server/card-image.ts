// An Instagram post's card as Instagram takes it (developers.facebook.com/docs/instagram-platform/content-publishing):
// a JPEG, its aspect ratio between 4:5 and 1.91:1, from 320 to 1440 pixels wide. The owner uploads a JPEG or a PNG
// (the browser has already scaled it down: lib/card-upload.ts), told apart by its first bytes and by what sharp decodes
// (never by its name or the browser's type); it is decoded and written again as a JPEG (sharp): turned upright, cropped
// about its centre into the allowed ratio, scaled into the allowed width, any transparency set on white, and its
// metadata (a phone's location among it) dropped. Null for anything else, and for an upload over the cap.
import "server-only";
import { CARD_MAX_BYTES, isJpeg } from "@munshi/core";
import sharp from "sharp";
import { MAX_CARD_UPLOAD } from "../card-upload";

export { MAX_CARD_UPLOAD };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sniff = (b: Buffer): "jpeg" | "png" | null =>
  b.length > 8 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpeg" : b.subarray(0, 8).equals(PNG) ? "png" : null;

const [TALLEST, WIDEST] = [4 / 5, 1.91];
const [NARROWEST, BROADEST] = [320, 1440];

export async function cardJpeg(upload: Buffer): Promise<Buffer | null> {
  if (upload.length > MAX_CARD_UPLOAD) return null;
  const kind = sniff(upload);
  try {
    const meta = await sharp(upload, { limitInputPixels: 40_000_000 }).metadata();
    if (!kind || meta.format !== kind || !meta.width || !meta.height) return null;
    const turned = (meta.orientation ?? 1) >= 5;
    const [w, h] = turned ? [meta.height, meta.width] : [meta.width, meta.height];
    const ratio = Math.min(Math.max(w / h, TALLEST), WIDEST);
    const cropW = Math.min(w, h * ratio);
    const width = Math.round(Math.min(Math.max(cropW, NARROWEST), BROADEST));
    // Whole pixels, rounded toward the inside of Instagram's range: never taller than 4:5, never wider than 1.91:1.
    const height = Math.min(Math.floor(width / TALLEST), Math.max(Math.ceil(width / WIDEST), Math.round(width / ratio)));
    for (const quality of [85, 70]) {
      const out = await sharp(upload, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width, height, fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality })
        .toBuffer();
      if (out.length <= CARD_MAX_BYTES && isJpeg(out)) return out;
    }
    return null;
  } catch {
    return null;
  }
}
