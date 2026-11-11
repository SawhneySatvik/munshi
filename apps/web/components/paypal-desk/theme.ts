import { themeQuartz } from "ag-grid-community";

// AG Grid's Quartz theme (the Theming API) on Munshi's own tokens (styles/tokens.css): the ledger's paper and ink,
// hairline rules between rows, coral only for focus and the row a person is on. The tokens are light only, so is
// the grid. The params are CSS, so a shop's look (lib/brand.ts overrides the same custom properties) reaches the grid.
export const deskTheme = themeQuartz.withParams({
  browserColorScheme: "light",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--ink-muted)",
  accentColor: "var(--accent)",
  borderColor: "var(--hairline)",
  chromeBackgroundColor: "var(--ground)",
  headerBackgroundColor: "var(--ground)",
  headerTextColor: "var(--ink-muted)",
  headerFontWeight: 600,
  headerFontSize: 13,
  fontFamily: "var(--font-text)",
  fontSize: 15,
  rowHoverColor: "color-mix(in srgb, var(--accent) 7%, transparent)",
  selectedRowBackgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
  oddRowBackgroundColor: "var(--surface)",
  rowBorder: { color: "var(--hairline)" },
  columnBorder: false,
  wrapperBorder: { color: "var(--hairline)" },
  wrapperBorderRadius: 14,
  borderRadius: 6,
  rowHeight: 56,
  headerHeight: 44,
  cellHorizontalPadding: 14,
  focusShadow: { radius: 2, spread: 0, color: "var(--accent)" },
  inputFocusBorder: { color: "var(--accent)" },
});
