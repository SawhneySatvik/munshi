import { ERRORS } from "@munshi/contracts";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { KIT } from "../../lib/kit";
import { Markdown } from "./Markdown";

/** One docs/kit page: its title, its Markdown, and what the page adds (the SDK's download, the error table). */
export function KitPageView({ slug, children }: { slug: string; children?: ReactNode }) {
  const page = KIT.pages.find((p) => p.slug === slug);
  if (!page) notFound();
  return (
    <>
      <h1>{page.title}</h1>
      {children}
      <Markdown md={page.md} />
      {slug === "auth-and-errors" ? <ErrorTable /> : null}
    </>
  );
}

// The error table, from the contracts' own (one message per code).
function ErrorTable() {
  return (
    <div className="d-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Status</th>
            <th scope="col">Message</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(ERRORS).map(([code, e]) => (
            <tr key={code} id={`error-${code}`}>
              <td>
                <code>{code}</code>
              </td>
              <td>
                <code>{e.status}</code>
              </td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
