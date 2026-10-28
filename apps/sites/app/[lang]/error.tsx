"use client";

import { StatusPage } from "../../components/StatusPage.tsx";

// The error object is deliberately unused: its message can carry raw text, and the page shows only fixed copy.
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <StatusPage kind="error" onRetry={reset} />;
}
