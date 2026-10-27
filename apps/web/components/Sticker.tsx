import type { ReactNode } from "react";
import "./Sticker.css";

/** flag: the tilted "Waiting for you" tab · yellow: "Simulated supplier", "Synthetic data" · ink: "Draft". */
export function Sticker({ tone, children }: { tone: "flag" | "yellow" | "ink"; children: ReactNode }) {
  return <span className={`sticker sticker-${tone}`}>{children}</span>;
}
