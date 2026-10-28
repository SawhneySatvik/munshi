"use client";

import { StatusNotice } from "../components/StatusNotice";

// The error object is deliberately unused: its message can carry raw text, and the page shows only fixed copy.
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <StatusNotice kind="error" onRetry={reset} />;
}
