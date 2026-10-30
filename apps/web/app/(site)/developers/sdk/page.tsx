import type { Metadata } from "next";
import { KitPageView } from "../../../../components/dev/KitPageView";
import { KIT } from "../../../../lib/kit";

export const metadata: Metadata = { title: "Munshi · SDK" };

export default function SdkPage() {
  const { href, sha256, version } = KIT.sdk;
  const file = href.split("/").pop() as string;
  return (
    <KitPageView slug="sdk">
      <div className="d-download">
        <a className="d-button" href={href} download>
          Download {file}
        </a>
        <p>
          Version <code>{version}</code>. sha256:
        </p>
        <code className="d-sha" data-sha256={sha256}>
          {sha256}
        </code>
      </div>
    </KitPageView>
  );
}
