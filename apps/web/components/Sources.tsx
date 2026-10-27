"use client";

import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { sameRef } from "../lib/snapshot";
import type { Snapshot, SourceRef } from "../lib/types";

export const DRAWER_ID = "source-drawer";
// Below this width the drawer is an overlay over the page; above it, a panel beside the brief (as in the reference).
const OVERLAY_QUERY = "(max-width: 1023.98px)";

type SourcesState = {
  snapshots: Snapshot[];
  /** The ref a person opened, or null. */
  openRef: SourceRef | null;
  /** Shown on the desk (and ringed there) while nothing is open; hidden on a phone. */
  deskRef: SourceRef | null;
  /** True when the open drawer covers the page (phone), so it acts as a modal dialog. */
  overlay: boolean;
  open: (ref: SourceRef, trigger: HTMLElement) => void;
  close: () => void;
};

const SourcesContext = createContext<SourcesState | null>(null);

export function SourcesProvider(props: { snapshots: Snapshot[]; deskRef: SourceRef | null; children: ReactNode }) {
  const [openRef, setOpenRef] = useState<SourceRef | null>(null);
  const [overlay, setOverlay] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const open = (ref: SourceRef, from: HTMLElement) => {
    trigger.current = from;
    setOverlay(window.matchMedia(OVERLAY_QUERY).matches);
    setOpenRef(ref);
  };
  const close = () => {
    setOpenRef(null);
    setOverlay(false);
    // After the render: while the modal is still up, the chip behind it is inert and cannot take focus.
    setTimeout(() => trigger.current?.focus());
  };

  return (
    <SourcesContext value={{ snapshots: props.snapshots, openRef, deskRef: props.deskRef, overlay, open, close }}>
      {props.children}
    </SourcesContext>
  );
}

export function useSources(): SourcesState {
  const state = useContext(SourcesContext);
  if (!state) throw new Error("useSources needs a SourcesProvider above it");
  return state;
}

/** Whether a number's ring shows: everywhere when its source is open, on the desk only when it is the default. */
export function useRing(ref: SourceRef): { on: boolean; desk: boolean } {
  const { openRef, deskRef } = useSources();
  return { on: sameRef(ref, openRef), desk: openRef === null && sameRef(ref, deskRef) };
}
