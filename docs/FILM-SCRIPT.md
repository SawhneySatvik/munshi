# Munshi film: script and storyboard (for the founder's review)

**Length: 2:55 (175 s), under the 3:00 limit.** Draft of 28 Oct 2026. Nothing here is rendered.
**Form:** a HyperFrames recreation (D-023) built from the real screens in `apps/web/.screenshots/MS-11/` and `MS-15/`
(true-390 phone frames; 1280 only for the model map). Scene vocabulary: stamped captions, the turmeric highlighter on the
cited cell, the "Where this number comes from" drawer, the red APPROVED stamp.
**Voice:** plain, short lines, about 1.4 words a second. See open choice 2 for who speaks.

## What the judges score, and where the film answers it
Source: `hackathon/meta-ai-developer-hackathon/BRIEF.md` section 6 and `raw/2026-10-27/cv-official-rules-and-waiver.md`
line 17. The top 5 per track are watched live; the video is also the first-pass triage (BRIEF section 11, item 16).

| Criterion | Weight | Where |
|---|---|---|
| Impact: who benefits, could people use it | 30 | Beats 1, 5, 6: a corner shop, a shelf that disagrees with the books, credit owed; beat 10 is honest that no pilot has happened |
| Use of Meta AI tooling: beyond a basic integration | 25 | Beat 8 (one flow, four Meta models, each doing one job) and the SAM 3.1 plus Spark pairing in beat 2 |
| Technical depth | 20 | Beats 7 and 9: the validator refuses typed numbers; the database refuses unapproved writes |
| Demo: works, holds up live, video quality | 25 | Aha inside 30 s; every beat is a real screen; the "Recorded response" label stays visible until the key lands (beat 10) |
| "Verifiable Agents" (Agents 102, Yash Khare, 28 Oct noon-1 pm; listed in `third-party/gh-vbshuliar_muse-for-watch-participant-guide-notes.md` line 19) | n/a | Only the title is captured; no notes exist. The film's thesis (cite or abstain, a person approves) fits it, but nothing here quotes the workshop |

## Where every number comes from
Nothing is typed by hand into the film. A figure is either in the seed (file and line) or "read from the screen": whatever
the shot screen shows, copied from the screenshot named. If the shoot screen differs, the screen wins and this table is fixed.

| Figure on screen | Value | Source |
|---|---|---|
| Shop and owner | "Sharma General Store (synthetic)", Rajesh Sharma | `db/seed/kirana.ts` line 26 (`SHOP`) and line 144 (`ownerName`) |
| Glucose biscuits: books vs shelf | 45 vs 18 | read from the screen: `MS-11/390-shelf-counted.png` (the books figure is the live seed stock, the shelf figure comes from the recorded SAM fixture). **Not the seed's planted gap**: the seed plants 6 packs short (`kirana.answers.json` lines 6-9, `kirana.ts` line 296), and that count was already booked on day -1. Do not say "six" or "Rs 51" over this shot |
| Butter: books vs shelf | 27 vs 12 | read from the screen: `MS-11/390-shelf-counted.png` |
| "Waiting for you" draft, "Approved by Rajesh Sharma" stamp | name and time | read from the screen: `MS-11/390-shelf-approved.png` (the time is the shoot time) |
| Bill number, supplier, quantity, unit price | GT-1050, Gupta Traders (simulated), 48 x Rs 8.50 | read from the screen: `MS-11/390-bill-photo-draft.png`; supplier at `kirana.ts` line 30, bill prefix line 31 |
| Butter price on the bill | Rs 62 | read from the screen: `MS-11/390-bill-photo-lines.png`. Compared with Rs 60 last paid (`kirana.ts` line 182 sets 6000 paise from day -30; `kirana.answers.json` lines 19-21: 5600 to 6000 paise). **The Rs 62 line is struck out on today's screen** ("Not in your catalogue: left out of the draft"), so no price-rise flag shows today. See the readiness table, beat 5 |
| Counter sales on 26 Oct | Rs 6,539 over 33 bills; Rs 3,527 cash, Rs 2,718 UPI | read from the screen: `MS-11/390-ask-voice-hi.png` and the drawer `MS-11/390-ask-source.png` |
| Most overdue on credit | Ramesh K., Rs 1,200, past due since 26 Sep | screen `MS-11/390-ask-credit.png`; seed: `kirana.answers.json` lines 30-34 (120000 paise, 31 days) |
| The unanswerable question | "What is the weather in Delhi today?" | read from the screen: `MS-11/390-ask-cannot-verify.png` |
| Model names | Muse Spark, SAM 3.1, Muse Voice Transcribe, Muse Spark Open | `README.md` table and `packages/agent/src/config.ts` (ids unconfirmed against a live call) |
| Test counts, red-proof counts | not shown | the README's counts were measured on 27 Oct and not re-run; a number on film must be re-measured the day it ships |

Labels on screen throughout (hard rule 3): a corner chip "Synthetic data" on every shot (the app header already carries it),
"SIMULATED" on the supplier, "Recorded response" while the key is absent, and "Payments are recorded, never processed" once
(the app footer, `MS-11/390-ask-voice-hi.png`, in Hindi; the English line is in `390-ask-cannot-verify.png`).

## Beat table
Readiness key: **R** = works today (recorded): shot from the existing screens, no key. **K** = needs the Meta key (live).
**P** = needs the real kirana photos (the shelf and bill photos are drawn today and say "Synthetic shelf photo (drawn)").

| # | Time | Screen and state | On-screen text | Narration | Ready? |
|---|---|---|---|---|---|
| 1 | 0:00-0:04 (4 s) | Phone, Sharma General Store. Cut to the books' stock row for Glucose biscuits, then the shelf photo, side by side. | Chip "Synthetic data". "The books" / "The shelf". | "The books say one thing. The shelf says another." | **R**; **P** for a real photo |
| 2 | 0:04-0:13 (9 s) | `/stock`, "Count a shelf from a photo". The photo drops in; one box draws on each biscuit pack; the card reads "Books say 45 / Shelf photo shows 18" with the SHELF GAP tag. "honey jar" sits under "Not in your catalogue". | Pills "Muse Spark names" then "SAM 3.1 counts" then "Code compares". The two figures as chips. | "A shelf photo. Spark names the products. SAM finds every pack. Code compares." | **R** (recorded SAM and Spark turns, `apps/web/fixtures/shelf/`); **K** to be live; **P** for a real shelf |
| 3 | 0:13-0:21 (8 s) | Tap the "Stock ledger" chip: the "Where this number comes from" drawer opens on the stock row, cell highlighted (the drawer as in `MS-11/390-ask-source.png`). Then the "Correct the books" draft slides in under "Waiting for you". | Sticker "EVERY NUMBER TRACES TO A ROW". Tag "WAITING FOR YOU". | "Every number opens to its row. Spark drafts the fix. It cannot write it." | Drawer **R**. The *written explanation* (`explainFinding`, "why is it short, from the books") has **no screen** today: either a new recorded Ask fixture (no key needed) or show the drawer only. See open choice 3 |
| 4 | 0:21-0:30 (9 s) | Phone mic button, "Listening...". Transcript appears in Devanagari. She taps Approve. The red stamp lands: "Approved, Rajesh Sharma, [time]". The card now reads "The books now hold 18". | Pill "Muse Voice Transcribe". Transcript: "haan, approve karo" (typed in Devanagari by the transcriber, see below). Stamp. | "She says yes, in Hindi. Voice Transcribe hears it. She taps approve. Her name goes on the books." | Approve stamp **R** (`MS-11/390-shelf-approved.png`). Mic **R** (`390-mic-listening.png`); **K** for a live transcript. **A spoken "approve" does not approve anything in the code today**: the transcript is asked as a question (`README.md`, step 3). The film must show the tap |
| 5 | 0:30-0:52 (22 s) | `/bills`, "Photograph a bill". The drawn Gupta Traders bill drops in. Lines appear, each figure with a "Read on the bill" chip. Butter at Rs 62 gets a flag "Rs 62 on the bill, Rs 60 last paid" with both as cells. The draft "Record the bill", GT-1050, "SIMULATED" tag. Approve; stamp. | Pill "Muse Spark reads". Chips "Read on the bill". Flag in turmeric. "SIMULATED" tag. Footnote "Not checked against your books" under the item text, as on screen. | "Then the supplier's bill. Spark copies the lines, and every figure points back to the page. Code matches them to her catalogue and flags a price that rose. This supplier is simulated. Nothing real is sent." | Reading and draft **R**. **The price-rise flag is not on any screen**: the code flags it (`packages/agent/src/bill.ts` line 6) but the recorded bill fixture's butter line is uppercase and unmatched, so it is dropped. Needs one re-recorded bill fixture (no key) with butter matching and above Rs 60. **K** live. **P** real bill |
| 6 | 0:52-1:14 (22 s) | Ask. She asks in Hindi: "कल काउंटर पर कितनी बिक्री हुई?" (`390-ask-voice-hi.png`). The answer: Rs 6,539, 33 bills, Rs 3,527 cash, Rs 2,718 UPI, each a chip. Tap Rs 6,539: the drawer, the cell highlighted (`390-ask-source.png`). Then "Who is most overdue on credit?" answers Ramesh K., Rs 1,200 (`390-ask-credit.png`). | Pills "Voice Transcribe", "Spark routes, Spark reasons". Chips. Sticker "A NUMBER IS A CELL, NEVER TEXT". | "She asks out loud, in Hindi. Every number is a chip. Tap one and see the row. The model never types a number. The server does." | **R** (recorded; the screens say "Recorded response"). **K**: the same two questions live, with Spark routing and Voice Transcribe hearing real speech |
| 7 | 1:14-1:30 (16 s) | She asks something the books cannot answer: "What is the weather in Delhi today?" The card shows the CANNOT VERIFY chip with the fixed words (`390-ask-cannot-verify.png`). Quick second cut, if shot live: an answer the validator refused, same fixed words, never the model's text. | Chip "CANNOT VERIFY". Small text "The assistant did not answer." | "When a number cannot trace to a row, Munshi does not guess. It says: cannot verify." | Today's state is the *no-fixture* degrade, not the validator firing on a real model answer. **R** for the screen; **K** for the honest version (the validator refusing live Spark text). The corpus (199 clean, 157 attacks, `README.md`) is a test, not a shot |
| 8 | 1:30-1:52 (22 s) | Model map drawn over the product: four tags on four steps, in the order of the film. Footer line "Built with Muse Spark Open". | "Muse Spark: routes, reasons, reads shelves and bills." "SAM 3.1: finds every pack, one product per request." "Muse Voice Transcribe: Hindi and English speech to text." "Muse Spark Open on Baseten: writes the short answer (open weights)." "Code does all the arithmetic." | "Four Meta models, four jobs. Spark routes, reasons and reads photos. SAM counts packs. Voice Transcribe hears Hindi. Spark Open, on Baseten, writes the short answer. Code does every sum." | Drawing **R**. **K** to say any of it is live: no model has been called yet (`docs/LIMITATIONS.md`). The licence requires the visible "Built with Muse Spark Open" (BRIEF 7.5) |
| 9 | 1:52-2:16 (24 s) | A drawn card, then the stamped line. Three rows, typed on one at a time: "The agent's database role has no write grant." / "The database refuses any book row without an approved draft, in the approver's name." / "A number renders only from a stored cell." Then the One Guarantee, whole, on ledger paper. | The guarantee: "Nothing changes the books without a named person's approval, and every number shown traces to a ledger row." Footer "Nothing auto-applies." | "Here is the rule. Nothing changes the books without a named person's approval. And every number traces to a ledger row. The agent has no write access. The database enforces it, not the prompt." | **R**: all three are gated in `db/` and `packages/agent` (README, "The guarantee"). No test count on screen |
| 10 | 2:16-2:42 (26 s) | A plain card, four lines typed on one at a time. | "Limits, 28 Oct 2026:" / "No live Meta model has been called. Every model turn here is a recorded response." / "SAM counts and Hindi accuracy on real photos and speech: to be measured." / "The cited-number check errs towards refusing." / "Synthetic data. Simulated suppliers. Payments are recorded, never processed. No pilot yet." | "What is not proven. No live Meta model has run yet, so these answers are recorded. Real photos and Hindi speech are still to be measured. The checker would sooner refuse than guess. Data synthetic, suppliers simulated, money only recorded." | Text **R**. **K** replaces the first two lines with measured figures (the shelf-count error against hand counts, the transcript word error) taken on the final commit. **P** for the real-photo line. Until then the card says "to be measured" and quotes no figure |
| 11 | 2:42-2:55 (13 s) | End card, Munshi mark on ledger paper, then the Sharma store screen once more. | Repo URL (placeholder `REPO-URL-PENDING`). Demo URL (`LIVE-URL-PENDING`). "Synthetic data. Simulated suppliers. Built with Muse Spark Open." | "Munshi. A back office that shows its work, and waits for a person. Code and demo, linked below." | Text **R**; the two URLs are blank until the repo is public and deployed (not in this lane) |

**Total:** 4+9+8+9+22+22+16+22+24+26+13 = 175 s = 2:55. Beats 1-4 end at 0:30: the aha lands as the stamp does.
Narration is counted in the check below, about 1.3 words a second, so every line has room.
Check at the build: the clock test pattern (contiguous windows, a hard ceiling of 180 s).

## Readiness, in the order it blocks the shoot
1. **Meta key (K).** Beats 2, 4, 5, 6, 7, 8 and 10 can be shot recorded today and are honest about it on screen, but "holds up
   live" (Demo 25) wants at least beats 2, 4 and 6 live, and the limits card (beat 10) wants measured figures. Without the key
   the film must say "recorded" and score lower on Meta tooling.
2. **A bill fixture that flags the price rise (R, not the key).** Beat 5's promised flag does not render in any screenshot.
   One re-recorded bill (butter spelled to match the catalogue, above Rs 60) fixes it. Until then, beat 5 shows the lines and the
   draft only, and the flag line is cut (the cut saves about 6 s).
3. **A written "why is it short" answer (R, not the key).** `explainFinding` has no screen. Beat 3 falls back to the drawer.
4. **Real kirana photos (P).** Today's shelf and bill are drawn and labelled so. The film can use them (they say "Synthetic
   shelf photo (drawn)"); real photos of a real shop need that shopkeeper's consent, and hard rule 3 still applies (say so on screen).
5. **Public repo and deployed URL**, for beat 11.

## Scene vocabulary
| Beat | Source | New |
|---|---|---|
| 1-4 | `MS-11/390-shelf-*.png`, `390-mic-listening.png`, `390-shelf-approved.png` | Side-by-side opener; the model pills |
| 5 | `MS-11/390-bill-photo-*.png`, `MS-15/390-bill-note.png` | The price-rise flag (after the fixture) |
| 6, 7 | `MS-11/390-ask-voice-hi.png`, `390-ask-source.png`, `390-ask-credit.png`, `390-ask-cannot-verify.png` | none |
| 8-11 | none | Model map, guarantee card, limits card, end card |

## Open choices for the founder
1. **Does "haan, approve karo" approve?** In the code the transcript is asked like a question; it cannot approve, and it should
   not (the guarantee wants a named person's tap). Recommended: she says it, the transcript shows, and she taps Approve (as
   written in beat 4). The alternative, a spoken approval, is a new feature and a guarantee change (a transcript becomes an
   approving act); not in scope for this script.
2. **Who speaks?** Muse Spark Open writes text; it does not produce audio. The script treats "narration on Baseten" as the
   product's *answer text*, shown on screen in beats 6 and 8. The film's own voiceover needs a human voice or a TTS that is not
   Meta's. Say which, and whether a non-Meta voice is acceptable for the 25-point "Meta tooling" story (it is the film's voice,
   not the product).
3. **Shoot with the key, or cut to what is real.** If the key and real photos do not arrive in time: keep the film recorded, keep
   every "Recorded response" label, drop the price-rise flag (beat 5) and the written explanation (beat 3), and let beat 10
   carry the honesty. This costs 12 s, which can go to a longer beat 6. Say if you would rather hold the shoot for the key.

## Word count check
The narration cells in the beat table total 254 words (counted by script on 28 Oct) over 175 s: 1.45 words a second on
average. The densest are beat 4 (18 words in 9 s) and beat 10 (40 in 26 s); if the read-through runs long, trim beat 10
first, then the second sentence of beat 5.
