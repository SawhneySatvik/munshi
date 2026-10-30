import type { Metadata } from "next";
import { KitPageView } from "../../../components/dev/KitPageView";

export const metadata: Metadata = { title: "Munshi · Developers" };

export default function DevelopersHome() {
  return <KitPageView slug="overview" />;
}
