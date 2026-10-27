---
workflow: hyperframes
flow: automation
storyboard: no
message: "A back office whose agents show their work: every number traces to a row, and nothing changes the books until a named person taps Approve."
destination: hackathon-submission
aspect: 1920x1080
language: en
length: 175s
audience: Meta Global AI Developer Hackathon judges (Indie track)
---

## Intent

Munshi's film for the Meta hackathon, draft 1. The script is `../docs/FILM-SCRIPT.md` (2:55, 11 beats) with the founder's
decisions D-035: approval is a tap (the voice asks and finds the draft; the owner taps Approve), the narration is the
local Kokoro voice the Munim Cup film used (text written fresh for Munshi), and the build runs now on recorded model
responses with "Recorded response" visible. The AI beats will be re-shot live, so each beat is a fixed window whose
screen can be swapped without retiming.

## Assets

- `assets/screens/*.png` — real Munshi screens captured by `tools/capture.mjs` from `pnpm dev` (true 390×844, 3×).
- `assets/art/shelf.png`, `assets/art/bill.png` — Munshi's own drawn synthetic shelf and bill (labelled "drawn").

## Notes

- Fresh-asset rule: written new in this folder. The Munim launch film was read for its look and voice approach only.
- Every number on screen is in a captured screen; the film's own text carries no figures (dates and model versions aside).
- Placeholders: the voice finding the draft (no screen exists), live model outputs (labelled recorded), measured limits
  ("to be measured"), the live and repo URLs on the end card.
- No music or sound effects in draft 1 (the bundled effects are third-party; an original bed is a later pass).
