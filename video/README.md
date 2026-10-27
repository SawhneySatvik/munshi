# Munshi film, draft 1 (Meta hackathon)

The 2:55 film of `docs/FILM-SCRIPT.md` with the founder's decisions D-035: approval is a tap (the voice asks and finds
the draft; the owner taps Approve), the narration is the local Kokoro voice the Munim Cup film used (text written for
Munshi), and the AI beats run on recorded responses with "Recorded response" on screen. Built with HyperFrames (HTML
rendered to video). Written new for Munshi; the Munim launch film was read for its look and voice approach only.

## Rebuild

Node 22+, ffmpeg, Google Chrome. Run from this folder. The CLI is pinned in `package.json` (`hyperframes@0.8.209`).

```bash
# 1. Screens: start the app in an isolated copy (its own .run/), on a free port, then capture. Approving writes to the
#    books, so restart the app (it reseeds) before every full capture. Fails if a box the film needs is missing.
node tools/capture.mjs http://localhost:3100/          # -> assets/screens/*.png, assets/js/spots.js
# 2. Voice: Kokoro-82M (bf_emma) on this machine, one WAV per clock line; fails if a line overruns its window.
uv venv .venv && uv pip install --python .venv/bin/python kokoro-onnx soundfile   # once
node audio/voice.mjs                                    # -> assets/voice/<id>.wav
node tools/make-captions.mjs                            # -> compositions/captions.html
node audio/mix.mjs                                      # -> assets/audio/narration.wav (-14 LUFS, limiter at -2 dBFS)
node tools/fonts.mjs                                    # once: the app's three faces -> assets/fonts
# 3. Check, render, mux the narration, gate.
node --test tests/*.test.mjs                            # the clock: contiguous beats under 180 s, lines fit
npx hyperframes@0.8.209 check
npx hyperframes@0.8.209 render --quality delivery --workers 2 -o renders/munshi-draft1-picture.mp4
ffmpeg -i renders/munshi-draft1-picture.mp4 -i assets/audio/narration.wav -map 0:v -map 1:a -c:v copy -c:a aac \
  -b:a 192k -ar 48000 -shortest -movflags +faststart renders/munshi-draft1.mp4
node tools/check-duration.mjs renders/munshi-draft1.mp4  # under 180.0 s, 1920x1080, 30 fps, AAC
```

## How it is put together

| Path | What |
|---|---|
| `assets/js/clock.js` | The clock: 11 beat windows (fixed, from the script), the narration lines (caption text and voice text) |
| `index.html` | Root: one host per beat at its window, the disclosure chips, the captions, the narration |
| `compositions/b01…b11-*.html` | One scene per beat; each names the screens it shows in its header comment |
| `compositions/chrome.html` | "Synthetic data" all film; "Recorded response" over b02-b07 |
| `assets/js/kit.js` | The motion kit `K`: phone, screen swaps, scrolls, lifts (a crop of the screen at film scale), taps, ink circle, underline, highlighter, the app's stamp landing |
| `assets/js/spots.js` | Written by `tools/capture.mjs`: every box the film draws on, read from the live page at capture time |
| `assets/css/look.css` | The app's ledger look (`apps/web/styles/tokens.css`, `design/munim-look`) at film scale |

## Swapping a screen (the live re-shoot)

Every beat is a fixed window in the clock, and nothing in a scene is timed from a screen. To swap:

- **A new still of the same state** (the live model answering): re-run `tools/capture.mjs` with the app in live mode.
  The PNGs keep their names and `spots.js` is rewritten, so the highlighter, circles, taps and lifts follow the new
  layout. No time changes.
- **A screen recording** (a live beat filmed whole): in that beat's file, replace the layer `<img>`s with one muted
  `<video class="clip">` spanning the same seconds. The overlays read their boxes from the stills, so re-check or drop
  them for that beat. The window, the narration and the captions stay as they are.

## Final and placeholder

| Beat | State |
|---|---|
| b01 books vs shelf | Final (real stock row; Munshi's drawn shelf, labelled "drawn") |
| b02 count a shelf, b03 source drawer and draft | Real screens, recorded SAM / Spark turns, labelled; re-shoot live |
| b04 tap to approve | Mic and the approval stamp are real; **the voice finding the draft is a PLACEHOLDER** (no such screen or feature yet) |
| b05 the bill | Real screens after the bill-fix fixture (ab5cb0c): the price-rise flag shows; recorded; re-shoot live |
| b06 Ask in Hindi, b07 cannot verify | Real screens, recorded; b07 shows the no-recording fallback and says so; re-shoot live |
| b08 models, b09 guarantee | Final text (model ids unconfirmed against a live call) |
| b10 limits | "To be measured" until the live figures exist |
| b11 end card | `REPO-URL-PENDING` and `LIVE-URL-PENDING` (root variables `repo_url`, `live_url`) |

## Provenance

| What | Source | Licence |
|---|---|---|
| Phone screens | Munshi's own app (`pnpm dev`, synthetic seed of 27 Oct 2026, recorded model responses), captured 28 Oct 2026 | Munshi |
| Shelf and bill images | `packages/agent/fixtures/media/shelf.png`, `bill.png`: drawn for Munshi, each labelled synthetic / drawn | Munshi |
| Mark | `apps/web/app/icon.svg` | Munshi |
| Paper grain | `assets/art/grain.svg`, written for this film | Original |
| Fonts | Bricolage Grotesque, Atkinson Hyperlegible, IBM Plex Mono from Google Fonts (`tools/fonts.mjs`) | SIL OFL 1.1 |
| GSAP 3.14.2 | npm `gsap`, vendored in `vendor/` | GreenSock standard licence |
| Voice | Kokoro-82M, voice `bf_emma`, run locally through `hyperframes tts` (kokoro-onnx in `.venv`) | Apache 2.0 / MIT |
| Music, sound effects | None in draft 1 | — |

Every figure on screen is inside a captured screen. The film's own words carry no figures, apart from the date on the
limits card and the model version "SAM 3.1".
