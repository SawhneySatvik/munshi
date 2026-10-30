import type { Metadata } from "next";
import { Reference } from "../../../../components/dev/Reference";
import { KIT } from "../../../../lib/kit";

export const metadata: Metadata = { title: "Munshi · API reference" };

export default function ReferencePage() {
  return (
    <>
      <h1>Reference</h1>
      <p className="d-lede">Every route of API v1, from the same contracts the server parses with (openapi.json).</p>
      <Reference routes={KIT.reference} />
    </>
  );
}
