# Review, draft 1 (28 Oct 2026)

## Creative calls
- The app's own ledger look at film scale (paper, ink, ledger red, turmeric, 4 px ink outlines, hard shadows): the
  phone on the left holds the real captured screen; the evidence is lifted out of it at 2-2.5x on the right
  ("isolate the action, then return it"), so every figure the judge reads is the app's own pixels.
- Beat windows are the script's, fixed. Inside them the voice is the clock; on-screen events land on their words.
- Drawn media carry film labels too ("The shelf · drawn", "Drawn photo", "Drawn bill"): the fixtures' own printed
  labels are too small to read at film scale.
- D-035 in beat 4: "Her voice finds it. Only her tap approves it." The voice-finding-the-draft moment is a labelled
  PLACEHOLDER inside the phone that says the feature is not built yet, then the real tap and the app's own APPROVED stamp.
- Line 7.3 added ("a figure with no row behind it is never shown", true of `Cell.tsx`) to fill a 5.7 s silence at
  the end of beat 7. Draft 1 has no music or effects (bundled effects are third-party; an original bed is a later pass).

## Measured, looked at, not checked
- `hyperframes check`: 0 lint / runtime / layout errors, contrast 96/96. Kept on purpose: `timeline_track_too_dense`
  (one caption track by design) and one `dead_stretch` at 80.0-83.3 s (the ink circle draws there; the detector does
  not see SVG strokes).
- `node --test tests/*.test.mjs` 3/3; red-proved with a 181 s clock (exit 1). `tools/capture.mjs` red-proved with a
  missing required spot (exit 1).
- Frames read by eye: about 60 snapshots across every beat and the ten seams.
- `renders/munshi-draft1.mp4`: 175.00 s, 5250 frames, 1920x1080, 30 fps, AAC; -14.1 LUFS, -1.8 dBTP (measured on the
  mp4). `tools/check-duration.mjs` passes, and fails (exit 1) with `--max 170`. Twelve frames pulled from the render
  were read by eye. The narration is measured, not heard.

## Weakest shots
- b08 (models) is a ruled table with no product picture behind each model; a live cut should put each model on its
  screen.
- b01 holds two cards on a mostly empty page for 4 s.
- Captions are 30 px in the right column; at phone width they are small.
