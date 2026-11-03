// The India pack's GST rules, as data with effective dates: the rate of each tax class on a day, and the one price rule
// (apparel by the selling price of a piece). Code reads these; no rate lives in code paths or in SQL. Prices include
// GST. Synthetic data only: every rule here is inferred from public sources, and a chartered accountant checks it
// before any real invoice.
//   - salon_service: 5% without input credit from 22 Sep 2025 (per press reports of the GST rate change).
//   - apparel: 5% when a piece sells at ₹2,500 or less, 18% above it (per EY's summary; the notification itself was not
//     read). Judged on the piece's selling price after its discount, since GST is worked on the
//     discounted price (inferred).
//   - general_5, general_18, exempt: plain slabs for any other item.
// A day before a class's first band has no rate, and a sale at a registered shop is then refused, never guessed.

export type TaxBand = {
  from: string; // YYYY-MM-DD, the first business day the band applies
  rateBp: number; // basis points: 500 is 5%
  above?: { pieceMinor: number; rateBp: number }; // a higher rate for a piece selling above this price
};

export type CountryPack = { country: string; taxClasses: Readonly<Record<string, readonly TaxBand[]>> };

export const IN_PACK: CountryPack = {
  country: 'IN',
  taxClasses: {
    salon_service: [{ from: '2025-09-22', rateBp: 500 }],
    apparel: [{ from: '2025-09-22', rateBp: 500, above: { pieceMinor: 250_000, rateBp: 1800 } }],
    general_5: [{ from: '2017-07-01', rateBp: 500 }],
    general_18: [{ from: '2017-07-01', rateBp: 1800 }],
    exempt: [{ from: '2017-07-01', rateBp: 0 }],
  },
};

// The rate of a line of `taxClass` on `day`, whose `netMinor` (the price paid, after its discounts) buys `qtyMilli`;
// undefined for a class or day the pack does not cover.
export function gstRateBp(pack: CountryPack, taxClass: string, day: string, netMinor: number, qtyMilli: number): number | undefined {
  const band = [...(pack.taxClasses[taxClass] ?? [])].filter((b) => b.from <= day).sort((a, b) => (a.from < b.from ? 1 : -1))[0];
  if (!band) return undefined;
  // net ÷ pieces > threshold, without dividing: net × 1000 > threshold × qty_milli
  return band.above && BigInt(netMinor) * 1000n > BigInt(band.above.pieceMinor) * BigInt(qtyMilli) ? band.above.rateBp : band.rateBp;
}
