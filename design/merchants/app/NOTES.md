# MS-16b: the new app screens (mock, static HTML + CSS, no script)

Tokens and component shapes (paper, ink, red, marigold, hard shadows, mono source chips, dashed "Cannot verify") are the
approved Munim look's values, declared again in `app.css`. Fonts load from Google Fonts as in `design/munim-look`.
Art is drawn SVG; the suit card is placeholder art ("the shop's photo goes here"). Nothing is built from these yet.

| Screen | File | Notes |
|---|---|---|
| Campaign composer (suit shop, Diwali) | `campaign.html` | Audience count, left-out count, offer figures, test-phone count all carry chips; Hinglish copy labelled "Written with AI" with the disclosure line; the name is the only per-customer fill, offer figures are filled from the offer row; channel "WhatsApp · sent to consenting test phones". |
| Voice note to draft | `voice-note.html` | Two drafts: salon booking request, kirana udhaar entry. Hindi transcript with English gloss, "Transcribed with AI". Udhaar shows one "Cannot verify" line (no milk sale row). |
| Package balance (salon) | `package-balance.html` | Active pack with balance, liability, ledger rows (sold, redeemed, expired) each with balance after and a row chip; redeem button turns off at zero. |
| Loyalty and counter redeem | `loyalty.html` | Points ledger plus the counter step; the entered points are labelled "Your entry", the discount and new balance are cited. |
| Spreadsheet table | `spreadsheet.html` | Desktop grid with 3 edits (yellow), 1 pasted row, 1 error cell, "Review 4 changes" bar and review panel (old value with chip, new value labelled "Your edit"/"Pasted by you"). Under 1024px it becomes cards with a "Paste rows" box. |
| Developer kit | `developer-kit.html` | Key shown once (hash only stored), allowed origins, snippet, docs link. |

Choices to know: in the grid, per-row source chips stand for the row's cells (one chip per row, not per cell); changed
cells show the old value struck through. Phone shots are full-length scrolls at 390 px wide (not clipped to 844) and
desktop shots are full-page at 1280 px; both were cropped to content. Headless Chrome will not render below about 500 px
wide, so phone shots render the page in a 390 px iframe and crop. Dates and weekdays are plain text (calendar facts or
row dates); every count, price, balance and point figure has a chip.
