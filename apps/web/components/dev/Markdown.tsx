import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The portal's Markdown (docs/kit): headings, paragraphs, lists, tables, fenced code, and inline code, bold and links.
 * It builds React elements and never sets HTML, so a page can carry no markup of its own. The page's own `#` title is
 * the layout's heading, so the first `#` line is dropped.
 */
export function Markdown({ md }: { md: string }) {
  const lines = md.replace(/^# .*\n+/, "").split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i] as string;
    const key = `b${i}`;
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      for (i++; i < lines.length && !(lines[i] as string).startsWith("```"); i++) body.push(lines[i] as string);
      i++;
      out.push(
        <pre key={key} className="d-code" data-lang={lang || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
    } else if (/^#{2,3} /.test(line)) {
      const text = line.replace(/^#+ /, "");
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      out.push(line.startsWith("### ") ? <h3 key={key} id={id}>{inline(text)}</h3> : <h2 key={key} id={id}>{inline(text)}</h2>);
      i++;
    } else if (line.startsWith("|")) {
      // Each row and cell keyed by its line and column in the source.
      const rows: { key: string; cells: { key: string; text: string }[] }[] = [];
      for (; i < lines.length && (lines[i] as string).startsWith("|"); i++) {
        const row = `r${i}`;
        rows.push({ key: row, cells: cells(lines[i] as string).map((text, col) => ({ key: `${row}c${col}`, text })) });
      }
      const [head, , ...body] = rows;
      out.push(
        <div key={key} className="d-table">
          <table>
            <thead>
              <tr>
                {(head?.cells ?? []).map((c) => (
                  <th key={c.key} scope="col">
                    {inline(c.text)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r) => (
                <tr key={r.key}>
                  {r.cells.map((c) => (
                    <td key={c.key}>{inline(c.text)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (line.startsWith("- ")) {
      const items: { key: string; text: string }[] = [];
      for (; i < lines.length && /^(- | {2}\S)/.test(lines[i] as string); i++) {
        const l = lines[i] as string;
        const last = items[items.length - 1];
        if (l.startsWith("- ") || !last) items.push({ key: `l${i}`, text: l.replace(/^- /, "") });
        else last.text += ` ${l.trim()}`;
      }
      out.push(
        <ul key={key}>
          {items.map((t) => (
            <li key={t.key}>{inline(t.text)}</li>
          ))}
        </ul>,
      );
    } else {
      const para: string[] = [];
      for (; i < lines.length && (lines[i] as string).trim() && !/^(```|#|\||- )/.test(lines[i] as string); i++) para.push((lines[i] as string).trim());
      out.push(<p key={key}>{inline(para.join(" "))}</p>);
    }
  }
  return <div className="d-prose">{out}</div>;
}

const cells = (row: string) =>
  row
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

// `code`, **bold** and [text](href), left to right; anything else is text.
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const key = `i${m.index}`;
    if (m[1] !== undefined) parts.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined) parts.push(<strong key={key}>{m[2]}</strong>);
    else {
      const href = m[4] as string;
      parts.push(
        href.startsWith("/") ? (
          <Link key={key} href={href}>
            {m[3]}
          </Link>
        ) : (
          <a key={key} href={href} rel="noopener noreferrer">
            {m[3]}
          </a>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
