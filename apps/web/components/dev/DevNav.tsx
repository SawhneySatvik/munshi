"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const DEV_LINKS = [
  ["/developers", "Overview"],
  ["/developers/getting-started", "Getting started"],
  ["/developers/auth-and-errors", "Authentication and errors"],
  ["/developers/figures", "Figures and refs"],
  ["/developers/guides", "Guides"],
  ["/developers/reference", "Reference"],
  ["/developers/sandbox", "Sandbox"],
  ["/developers/sdk", "SDK"],
] as const;

/** The portal's section list: a row that scrolls on a phone, a column beside the page from 900 px. */
export function DevNav() {
  const path = usePathname();
  return (
    <nav className="d-nav" aria-label="Developer portal">
      <ul>
        {DEV_LINKS.map(([href, label]) => (
          <li key={href}>
            <Link href={href} aria-current={path === href ? "page" : undefined}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
