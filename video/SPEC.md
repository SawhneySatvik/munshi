# Munshi film, draft 1: spec

```text
GOAL:    the judge ends sure of two things: the shop's numbers each open to a row, and nothing changes the books until
         the owner taps Approve.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps.
TIME:    175 s x 30 = 5250 frames. Eleven fixed beat windows from docs/FILM-SCRIPT.md (assets/js/clock.js). No music.
LOOK:    the app's own medium, design/munim-look: a ledger page.
         ground paper #f3ead7, ruled every 54 px in #a9bccb at 28%, a ledger-red #b4232a margin rule at x 132, 2.5% grain;
         ink #1b1611 for every word and every outline (2.5 px, x1.6 at film scale = 4 px); hard offset shadow 8 px 8 px 0 ink;
         ledger red only for stamps, the margin and the ink circle; turmeric #f0b429 only for the highlighter and one chip
         per frame;
         display Bricolage Grotesque 800, 76 px, -2% tracking; body Atkinson Hyperlegible 700 at 34-40 px; labels IBM Plex
         Mono 600, 24 px caps, +8% tracking.
OBJECTS: the phone: the real captured screen in an ink-outlined body (radius 54, 4 px ink, shadow 12 px), 1.1x its 390 px
         width, left third of the frame; a fingertip (turmeric disc, ink ring) for every tap; the ink circle (a red
         hand-drawn loop, 1.15 turns); the highlighter (turmeric band, multiply); the APPROVED stamp is the app's own.
MOTION:  arrivals expo.out 0.5-0.7 s; camera power2.inOut 0.8 s; exits power3.in 0.3 s; screen swaps blur 8 px -> 0 in
         0.2 s; drawers wipe up 0.35 s; words land per word (blur 6 -> 0, 0.07 s apart), then hold dead still.
SHOTS:   b01 0-4    two cards: the books' row (45) and the drawn shelf; a red not-equal between them.
         b02 4-13   phone in; photo chosen; Count this shelf; boxes and the two gaps; pills Spark / SAM / Code.
         b03 13-21  tap the Stock ledger chip: the drawer, the cell; then the drafted correction, waiting.
         b04 21-30  mic: listening; PLACEHOLDER (the voice finds the draft); tap Approve; the stamp; books hold 18.
         b05 30-52  the bill: read, chips, the price-rise flag, the SIMULATED draft, tap, stamp.
         b06 52-74  Ask in Hindi (English translation chip): chips, tap, the drawer's cell; then credit, Ramesh K.
         b07 74-90  the weather question: CANNOT VERIFY, circled; footnote that this is the no-recording fallback.
         b08 90-112 four Meta models, four jobs, each beside its screen; "Built with Muse Spark Open".
         b09 112-136 the One Guarantee typed on the ledger; three enforcing rows; "Nothing auto-applies."
         b10 136-162 limits card, line by line, "to be measured".
         b11 162-175 the mark, the store's home screen, URL placeholders.
BANNED:  dark grounds, glow, gradients, glass; three cards in a row; everything centred; everything fading up; titles that
         drift after landing; click rings; any figure typed by the film that is not on a captured screen; the logo docked in
         a corner; a model output presented as live.
QA:      every beat's first and mid frame; the stamp frames (b04, b05); the drawer cells (b03, b06); the placeholder (b04);
         the end card; 360 px phone sheet for the captions.
```
