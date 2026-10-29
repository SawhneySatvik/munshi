import type { Metadata } from "next";
import { SiteHome } from "../../components/site/SiteHome";

export const metadata: Metadata = {
  title: "Munshi · The back office for a small shop",
  description: "An AI back office for a small shop: nothing changes the books without the owner's approval. Demo on synthetic data.",
};

// The product site's home. It reads no database: the site carries no figure from any shop's books.
export default function SiteHomePage() {
  return <SiteHome />;
}
