// The interface's own small icons, drawn here in one 2px stroke on a 24px grid. Business art lives in its business folder.
import type { ReactNode } from "react";

function Svg({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

export const Chevron = () => (
  <Svg>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const ArrowLeft = () => (
  <Svg>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const Pin = () => (
  <Svg>
    <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.8" r="2.3" />
  </Svg>
);

export const Clock = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const Check = () => (
  <Svg>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </Svg>
);

export const Plus = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Minus = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
);

export const Lines = () => (
  <Svg>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </Svg>
);

export const Cross = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const Chat = () => (
  <Svg>
    <path d="M4.5 18.5l1.2-3.6A7.6 7.6 0 1 1 9 18.2z" />
    <path d="M9 10.5h6M9 13.5h4" />
  </Svg>
);

export const Calendar = () => (
  <Svg>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </Svg>
);

export const Tag = () => (
  <Svg>
    <path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6l8 8a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0z" />
    <circle cx="8.3" cy="8.3" r="1.4" />
  </Svg>
);

/** The four-point star between marquee words. */
export const Star = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 0c.6 4.2 1.8 5.4 6 6-4.2.6-5.4 1.8-6 6-.6-4.2-1.8-5.4-6-6 4.2-.6 5.4-1.8 6-6z" fill="currentColor" transform="translate(0 2)" />
  </svg>
);

/** The hand-drawn stroke under a section heading. */
export const Underline = () => (
  <svg className="underline" viewBox="0 0 150 14" preserveAspectRatio="none" aria-hidden="true">
    <path d="M3 9.5C26 4.5 52 4 75 7.6S122 11.5 147 5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
  </svg>
);
