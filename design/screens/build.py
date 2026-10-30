#!/usr/bin/env python3
"""Rebuilds design/screens/index.html from .screenshots/<folder>/<name>-<390|1280>.png. Run from the repo root."""
import html, os, re

ROOT = '.screenshots'
GROUPS = [
    ('BP-WEB-1', 'Munshi product site, sign-up and demo picker', 'The public site at /, onboarding, log-in and the judges’ sample-shop path.'),
    ('BP-UI-1', 'App · the everyday screens', 'Home, counter, bills, stock, udhaar, suppliers, reports and Ask (the kirana).'),
    ('BP-APP', 'App · merchant features', 'Offers, packages, loyalty, customers, GST invoices, calendar, requests, staff, salary, orders, inbox, campaigns, settings and the morning brief, per shop.'),
    ('BP-RESTYLE', 'App · restyled', 'Every app screen in the picked look.'),
    ('BP-SITES-1', 'Hosted shop sites', 'Elite (salon) and Prabhave (boutique) through the SDK: booking, holds, order intake, tap-for-source.'),
    ('BP-CONSOLE', 'Superadmin console', '/platform: shops, defaults, channel grants, approve-later changes.'),
    ('BP-DEV-1', 'Developer portal', '/developers: getting started, reference, SDK, sandbox.'),
    ('HOSTED', 'Hosted demo', 'The hosted smoke run’s pages.'),
]

def card(group, name, files):
    wide, narrow = f'{name}-1280.png' in files, f'{name}-390.png' in files
    src = f'../../{ROOT}/{group}/{name}-{"1280" if wide else "390"}.png'
    phone = f'../../{ROOT}/{group}/{name}-390.png'
    label = html.escape(name.replace('-', ' ').replace('default', '').strip() or 'default')
    out = f'<figure class="card"><a href="{src}" target="_blank" class="shot wide"><img loading="lazy" src="{src}" alt="{label}, desktop"></a>'
    if wide and narrow:
        out += f'<a href="{phone}" target="_blank" class="shot phone"><img loading="lazy" src="{phone}" alt="{label}, phone"></a>'
    return out + f'<figcaption>{label}</figcaption></figure>'

sections, nav, total = [], [], 0
for group, title, desc in GROUPS:
    d = os.path.join(ROOT, group)
    if not os.path.isdir(d):
        continue
    files = [f for f in os.listdir(d) if f.endswith('.png')]
    names = sorted({re.sub(r'-(390|1280)\.png$', '', f) for f in files})
    total += len(names)
    nav.append(f'<a href="#{group}">{html.escape(title)} <span>{len(names)}</span></a>')
    cards = ''.join(card(group, n, files) for n in names)
    sections.append(f'<section id="{group}"><h2>{html.escape(title)}</h2><p class="desc">{html.escape(desc)} <span class="count">{len(names)} screens</span></p><div class="grid">{cards}</div></section>')

CSS = """:root{--bg:#f7f5ef;--ink:#1d1b16;--muted:#6b665a;--line:#e2ddd0;--card:#fffdf8;--accent:#3b3f8f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#16150f;--ink:#efeadc;--muted:#a49e8e;--line:#2f2c24;--card:#1f1d17;--accent:#a9adf0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:28px 16px 8px;max-width:1400px;margin:auto}h1{margin:0 0 4px;font-size:26px}header p{margin:0;color:var(--muted)}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);z-index:2}nav div{max-width:1400px;margin:auto;padding:10px 16px;display:flex;gap:16px;overflow-x:auto}
nav a{color:var(--ink);text-decoration:none;white-space:nowrap;font-weight:600}nav a span{color:var(--muted);font-weight:400}
main{max-width:1400px;margin:auto;padding:0 16px 60px}section{padding-top:28px}h2{font-size:20px;margin:0 0 4px}.desc{color:var(--muted);margin:0 0 14px}.count{color:var(--accent);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start}
.shot img{display:block;width:100%;border-radius:6px;border:1px solid var(--line);background:#fff}.shot.wide{grid-column:1}.shot.phone{width:62px}
.card:not(:has(.phone)) .shot.wide{grid-column:1/3}figcaption{grid-column:1/3;font-size:13px;color:var(--muted)}"""

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Munshi Screens</title><style>{CSS}</style></head><body>
<header><h1>Munshi — every screen as built</h1><p>{total} screens from <code>.screenshots/</code>, captured from the real <code>pnpm dev</code>. Click an image for full size; the small one is the phone width (390&nbsp;px).</p></header>
<nav><div>{''.join(nav)}</div></nav><main>{''.join(sections)}</main></body></html>"""
with open('design/screens/index.html', 'w') as f:
    f.write(page)
print(total)
