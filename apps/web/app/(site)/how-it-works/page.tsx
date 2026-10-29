import type { Metadata } from "next";
import { HowItWorks } from "../../../components/site/SiteHome";

export const metadata: Metadata = { title: "Munshi · How it works" };

export default function HowItWorksPage() {
  return <HowItWorks />;
}
