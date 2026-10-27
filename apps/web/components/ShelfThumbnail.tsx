import type { ShelfPhoto } from "../lib/types";
import "./ShelfThumbnail.css";

// Drawing units (the viewBox scales them): one packet per slot, boards under each shelf, red boxes over each run of gaps.
const PITCH = 13;
const LEFT = 8;
const SHELF = 26;

function layout(photo: ShelfPhoto) {
  const boards: number[] = [];
  const packets: Array<{ x: number; y: number }> = [];
  const gaps: Array<{ x: number; y: number; width: number }> = [];
  photo.shelves.forEach((shelf, i) => {
    boards.push(SHELF * (i + 1));
    let run: { x: number; y: number; width: number } | null = null;
    [...shelf].forEach((slot, j) => {
      const x = LEFT + PITCH * j;
      if (slot === "#") {
        packets.push({ x, y: SHELF * i + 7 });
        run = null;
      } else if (run) {
        run.width += PITCH;
      } else {
        run = { x: x - 1, y: SHELF * i + 5, width: PITCH };
        gaps.push(run);
      }
    });
  });
  return { boards, packets, gaps };
}

/** The shelf photo as a drawing made from its slots, with the empty spaces boxed in red. */
export function ShelfThumbnail({ photo, label, className }: { photo: ShelfPhoto; label: string; className?: string }) {
  const slots = Math.max(...photo.shelves.map((s) => s.length));
  const width = LEFT * 2 + PITCH * slots;
  const height = SHELF * photo.shelves.length + 6;
  const { boards, packets, gaps } = layout(photo);
  return (
    <svg className={className ? `shelf ${className}` : "shelf"} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {boards.map((y) => (
        <path key={y} className="board" d={`M4 ${y}h${width - 8}`} />
      ))}
      {packets.map(({ x, y }) => (
        <g key={`${x},${y}`}>
          <rect className="packet" x={x} y={y} width="11" height="18" rx="1.5" />
          <path className="band" d={`M${x + 2} ${y + 6}h7`} />
        </g>
      ))}
      {gaps.map(({ x, y, width: w }) => (
        <rect key={`${x},${y}`} className="gap" x={x} y={y} width={w} height="20" rx="2" />
      ))}
    </svg>
  );
}
