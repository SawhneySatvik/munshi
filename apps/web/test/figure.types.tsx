// A type test, run by tsc (`npx tsc --noEmit`; this file is in the project, never executed): <Figure> takes a cell ref,
// never a bare number or a string of digits. Each @ts-expect-error fails the typecheck the day the
// line under it starts to compile, i.e. the day Figure would accept a figure with no source.
import { Figure } from "../components/shell/Figure";
import type { SourceRef } from "../lib/types";

const ref: SourceRef = { label: { en: "Credit book", hi: "उधार खाता" }, snapshotId: "s", row: 1, col: "balance" };

export const accepted = [<Figure key="a" cell={ref} />, <Figure key="b" cell={ref} read="answer" table />, <Figure key="c" cell={null} />];

export const refused = [
  // @ts-expect-error a bare number has no source
  <Figure key="n" cell={2350} />,
  // @ts-expect-error a string of digits has no source either
  <Figure key="s" cell="₹2,350" />,
  // @ts-expect-error nor does an object holding the number
  <Figure key="o" cell={{ value: 2350 }} />,
  // @ts-expect-error digits cannot ride in as children
  <Figure key="c" cell={ref}>
    2350
  </Figure>,
  // @ts-expect-error the ref is required: a figure is never shown without one
  <Figure key="m" />,
];
