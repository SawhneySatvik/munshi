import type { ReactNode } from "react";
import "./Stamp.css";

/** The rubber stamp a decision leaves on the draft: red for approved, ink for rejected. */
export function Stamp({ tone, children }: { tone: "approved" | "rejected"; children: ReactNode }) {
  return <span className={`stamp stamp-${tone}`}>{children}</span>;
}
