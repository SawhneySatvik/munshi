// A bill's figure boxes settle on the print: the model reads the figure right but places its box a few percent off, by an
// amount that changes run to run. The page here is the demo bill's layout, with Muse Spark's boxes from two live runs.
import { expect, it } from "vitest";
import type { Box } from "../lib/hero-types";
import { snapToInk } from "../lib/ink-snap";

const W = 800;
const H = 1100;
const page = (print: Box[]) => {
  const gray = new Uint8ClampedArray(W * H).fill(250);
  for (const p of print) {
    for (let y = Math.round((p.y1 / 1000) * H); y < (p.y2 / 1000) * H; y++) {
      for (let x = Math.round((p.x1 / 1000) * W); x < (p.x2 / 1000) * W; x++) gray[y * W + x] = 30;
    }
  }
  return gray;
};
const at = (x1: number, y1: number, x2: number, y2: number): Box => ({ x1, y1, x2, y2 });
// Each row's item name, quantity, unit price and amount, where the bill prints them.
const rows = [317, 363, 408].flatMap((y) => [at(126, y, 361, y + 15), at(622, y, 646, y + 15), at(730, y, 784, y + 15), at(838, y, 921, y + 15)]);
const covers = (b: Box, p: Box) => b.x1 <= p.x1 + 2 && b.x2 >= p.x2 - 2 && b.y1 <= p.y1 + 2 && b.y2 >= p.y2 - 2;

it("boxes placed off the print settle together: each settles over its own figure, in each live run's boxes, though each is half a row from the next", () => {
  const gray = page(rows);
  const quantity = (r: number) => rows[r * 4 + 1] as Box;
  const price = (r: number) => rows[r * 4 + 2] as Box;
  for (const read of [
    [at(584, 292, 616, 313), at(687, 292, 753, 313), at(584, 338, 616, 359), at(677, 338, 753, 359), at(584, 385, 616, 406), at(677, 385, 753, 406)],
    [at(585, 285, 615, 305), at(690, 285, 755, 305), at(585, 330, 615, 350), at(681, 330, 755, 350), at(585, 375, 615, 395), at(681, 375, 755, 395)],
  ]) {
    const moved = snapToInk(gray, W, H, read);
    [0, 1, 2].forEach((r) => {
      expect(covers(moved[r * 2] as Box, quantity(r)), `quantity ${r}`).toBe(true);
      expect(covers(moved[r * 2 + 1] as Box, price(r)), `price ${r}`).toBe(true);
    });
  }
});

it("boxes already on their figures stay, and boxes with no ink in reach stay as read", () => {
  const gray = page(rows);
  const good = [at(618, 314, 650, 335), at(726, 360, 788, 381)];
  expect(snapToInk(gray, W, H, good)).toEqual(good);
  const empty = [at(100, 800, 140, 830)];
  expect(snapToInk(gray, W, H, empty)).toEqual(empty);
});
