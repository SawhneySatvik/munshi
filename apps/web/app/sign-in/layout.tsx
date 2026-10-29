import type { ReactNode } from "react";
import { TopBar } from "../../components/TopBar";

// Signed out: the top bar (the synthetic-data sticker and the language) over the page.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      {children}
    </>
  );
}
