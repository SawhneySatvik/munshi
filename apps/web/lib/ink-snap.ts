import type { Box } from "./hero-types";

// A vision model reads a figure correctly yet places its boxes a few percent off the print, by an amount that changes run
// to run, so no fixed correction holds. Within one reading the error is the same across the page, so all its boxes move
// together, on the 0–1000 grid, to where they cover the most ink: alone, a box half a row off fits the row above as well.
const REACH_X = 50;
const REACH_Y = 35;
const STEP = 3;
// Darker than the page by this much is ink.
const INK_BELOW = 50;
// A shift must cover this share more ink than the boxes do where they stand, or they stay put.
const WORTH_MOVING = 1.2;
const NEARLY = 0.8;
const ONE_ROW = 30;

/** `gray`: the page's pixels, row by row, 0–255. The boxes come back in order, moved together or as they were. */
export function snapToInk(gray: Uint8ClampedArray, width: number, height: number, boxes: Box[]): Box[] {
  let sum = 0;
  for (const v of gray) sum += v;
  const ink = sum / gray.length - INK_BELOW;
  // A summed-area table: the ink inside any rectangle in four reads.
  const stride = width + 1;
  const area = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      if ((gray[y * width + x] as number) < ink) row++;
      area[(y + 1) * stride + x + 1] = (area[y * stride + x + 1] as number) + row;
    }
  }
  const px = (n: number, size: number) => Math.min(size, Math.max(0, Math.round((n / 1000) * size)));
  const inside = (b: Box) => {
    const [x1, x2, y1, y2] = [px(b.x1, width), px(b.x2, width), px(b.y1, height), px(b.y2, height)];
    return (area[y2 * stride + x2] as number) - (area[y1 * stride + x2] as number) - (area[y2 * stride + x1] as number) + (area[y1 * stride + x1] as number);
  };
  const covered = (dx: number, dy: number) => boxes.reduce((n, b) => n + inside({ x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy }), 0);
  const shifts: { dx: number; dy: number; ink: number }[] = [];
  for (let dy = -REACH_Y; dy <= REACH_Y; dy += STEP) {
    for (let dx = -REACH_X; dx <= REACH_X; dx += STEP) shifts.push({ dx, dy, ink: covered(dx, dy) });
  }
  const best = Math.max(...shifts.map((s) => s.ink));
  if (best === 0 || best < covered(0, 0) * WORTH_MOVING) return boxes;
  // A bold column heading can fit as well as the right row. Where two rows fit about as well, take the lower: in every live
  // reading the model's boxes sat above the print, never below it.
  const lowest = Math.max(...shifts.filter((s) => s.ink >= best * NEARLY).map((s) => s.dy));
  const row = shifts.filter((s) => s.dy > lowest - ONE_ROW);
  const rowBest = Math.max(...row.map((s) => s.ink));
  // Every shift that holds the whole print is as good as another: their middle centres the boxes on it.
  const top = row.filter((s) => s.ink >= rowBest * 0.98);
  const mean = (k: "dx" | "dy") => Math.round(top.reduce((n, s) => n + s[k], 0) / top.length);
  const [dx, dy] = [mean("dx"), mean("dy")];
  return boxes.map((b) => ({ x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy }));
}

/** The photo's pixels as gray, at a working size. Null where a canvas is unavailable: the boxes then stay as read. */
export function grayOf(img: HTMLImageElement, maxWidth = 800): { gray: Uint8ClampedArray; width: number; height: number } | null {
  if (!img.naturalWidth) return null;
  const width = Math.min(maxWidth, img.naturalWidth);
  const height = Math.round((img.naturalHeight / img.naturalWidth) * width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] as number) * 0.3 + (data[i * 4 + 1] as number) * 0.59 + (data[i * 4 + 2] as number) * 0.11;
  return { gray, width, height };
}
