# Look A tokens: product site + Munim

The working screens use warm paper and ink, with a quiet ledger rhythm. The product site's warm black belongs to the
shell, the floating pill navigation and sign-in surfaces. Coral is the one accent; it marks actions and focus. Do not
use coral for small text on paper. No provider or model credit is shown in the interface.

## Colour tokens

| Token | Value | Use |
|---|---|---|
| `--ground` | `#f3ead7` | Main work surface |
| `--surface` | `#fbf6ea` | Cards, dialogs and sheets |
| `--wash` | `#e9dfca` | Quiet grouped rows |
| `--ink` | `#1b1611` | Primary text and figures |
| `--ink-muted` | `#5b4d40` | Secondary labels on paper |
| `--hairline` | `#d9ccb2` | Ledger rules and control edges |
| `--accent` | `#ff7f61` | Action fill, focus ring and selected marker |
| `--accent-ink` | `#1c0f0b` | Text on coral controls |
| `--shell` | `#151312` | App shell and sign-in background |
| `--shell-surface` | `#1d1a18` | Shell pill and raised dark surface |
| `--shell-text` | `#f2ece6` | Text on shell surfaces |
| `--shell-muted` | `#a69c93` | Secondary text on shell surfaces |

## Type, shape and spacing

- Use Gabarito for Latin interface text and Akshar for Devanagari, following the product site. Use IBM Plex Mono for
  short uppercase kickers, dates and ids; keep figures in the app's existing tabular figure face.
- Keep the working surface light. Use the display face for page titles and Gabarito/Akshar for controls, labels and
  body copy. Never use the mono face for paragraphs.
- Cards use a 14 px radius; controls 10 px; chips 999 px. Keep edges quiet and use one-pixel ledger rules.
- Use a 4 px base spacing step: 4, 8, 12, 16, 20, 24, 32 and 48 px. Leave generous space around page titles and
  sections. Ledger rows stay compact and align every amount on one right edge.
- Keep the floating pill navigation on the warm-black shell. Working pages use the app's existing responsive navigation
  and light surfaces.
- Tap-for-source figures keep the dotted underline and open their source cells. A missing source reads “Cannot verify.”

## Contrast checks

Ratios use WCAG relative luminance for the listed foreground/background pairs. Every text pair below exceeds 4.5:1;
coral is not used as text on paper.

| Text | Background | Ratio |
|---|---|---:|
| Ink `#1b1611` | Ground `#f3ead7` | 15.02:1 |
| Muted ink `#5b4d40` | Ground `#f3ead7` | 6.81:1 |
| Ink `#1b1611` | Surface `#fbf6ea` | 16.65:1 |
| Muted ink `#5b4d40` | Surface `#fbf6ea` | 7.55:1 |
| Shell text `#f2ece6` | Shell surface `#1d1a18` | 14.77:1 |
| Shell muted `#a69c93` | Shell `#151312` | 6.88:1 |
| Coral `#ff7f61` | Shell `#151312` | 7.46:1 |
| Accent ink `#1c0f0b` | Coral `#ff7f61` | 7.54:1 |
| Muted ink `#5b4d40` | Hairline `#d9ccb2` | 5.13:1 |
