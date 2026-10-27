// The film's clock: the eleven beats of docs/FILM-SCRIPT.md (2:55), their narration and the moments inside them. Every
// scene, the captions, the voice and the mix read only from here. A beat's window is fixed; re-shooting a beat's screen
// swaps its picture and keeps its window (README, "Swapping a screen").
// Lines: [id, start (s, absolute), caption text, text for the voice]. The voice text spells out what Kokoro misreads.
(function () {
  const beats = [
    // [id, start, end, what it shows]
    ["b01", 0, 4, "The books and the shelf disagree"],
    ["b02", 4, 13, "Count a shelf from a photo"],
    ["b03", 13, 21, "Every number opens to its row; the fix is drafted"],
    ["b04", 21, 30, "The voice finds the draft; the owner taps Approve"],
    ["b05", 30, 52, "The supplier's bill, read and recorded"],
    ["b06", 52, 74, "Ask in Hindi: every number is a chip"],
    ["b07", 74, 90, "Cannot verify"],
    ["b08", 90, 112, "Four Meta models, four jobs"],
    ["b09", 112, 136, "The One Guarantee"],
    ["b10", 136, 162, "What is not proven"],
    ["b11", 162, 175, "End card"],
  ];
  const lines = [
    ["1.1", 0.35, "The books say one thing. The shelf says another.", "The books say one thing. The shelf says another."],
    ["2.1", 4.4, "A photo of the shelf.", "A photo of the shelf."],
    ["2.2", 6.6, "Spark names the products. SAM finds every pack. Code compares.", "Spark names the products. Sam finds every pack. Code compares."],
    ["3.1", 13.4, "Every number opens to the row it came from.", "Every number opens to the row it came from."],
    ["3.2", 17.2, "Spark drafts the fix. It cannot write it.", "Spark drafts the fix. It cannot write it."],
    ["4.1", 21.3, "She asks out loud what is waiting, and Munshi finds the draft.", "She asks out loud what is waiting, and Moonshee finds the draft."],
    ["4.2", 25.6, "She taps Approve. Her name goes on the books.", "She taps Approve. Her name goes on the books."],
    ["5.1", 30.5, "Then the supplier's bill.", "Then the supplier's bill."],
    ["5.2", 33.2, "Spark copies the lines, and every figure points back to the page.", "Spark copies the lines, and every figure points back to the page."],
    ["5.3", 38.8, "Code matches them to her catalogue and flags a price that rose.", "Code matches them to her catalogue, and flags a price that rose."],
    ["5.4", 44.2, "This supplier is simulated. Nothing real is sent.", "This supplier is simulated. Nothing real is sent."],
    ["5.5", 48.3, "One tap, and the bill is in the books.", "One tap, and the bill is in the books."],
    ["6.1", 52.5, "She asks out loud, in Hindi.", "She asks out loud, in Hindi."],
    ["6.2", 56.2, "Every number in the answer is a chip. Tap one, and see its row.", "Every number in the answer is a chip. Tap one, and see its row."],
    ["6.3", 62.6, "The model never types a number. The server does.", "The model never types a number. The server does."],
    ["6.4", 67.6, "Ask who owes the most, and the same rule holds.", "Ask who owes the most, and the same rule holds."],
    ["7.1", 75.0, "Now ask something the books cannot answer.", "Now ask something the books cannot answer."],
    ["7.2", 79.6, "When a number cannot trace to a row, Munshi does not guess. It says: cannot verify.", "When a number cannot trace to a row, Moonshee does not guess. It says: cannot verify."],
    ["7.3", 85.6, "And on every screen, a figure with no row behind it is never shown.", "And on every screen, a figure with no row behind it is never shown."],
    ["8.1", 90.5, "Four Meta models, four jobs.", "Four Meta models, four jobs."],
    ["8.2", 93.4, "Muse Spark routes, reasons and reads the photos.", "Muse Spark routes, reasons, and reads the photos."],
    ["8.3", 97.6, "SAM counts the packs. Voice Transcribe hears Hindi.", "Sam counts the packs. Voice Transcribe hears Hindi."],
    ["8.4", 102.4, "Spark Open, on Baseten, writes the short answer.", "Spark Open, on Base Ten, writes the short answer."],
    ["8.5", 107.4, "And code does every sum.", "And code does every sum."],
    ["9.1", 112.5, "Here is the rule.", "Here is the rule."],
    ["9.2", 115.0, "Nothing changes the books without a named person's approval. And every number traces to a ledger row.", "Nothing changes the books without a named person's approval. And every number traces to a ledger row."],
    ["9.3", 124.6, "The agent has no write access.", "The agent has no write access."],
    ["9.4", 128.6, "The database enforces it, not the prompt.", "The database enforces it, not the prompt."],
    ["10.1", 136.5, "What is not proven yet.", "What is not proven yet."],
    ["10.2", 139.4, "No live Meta model has run, so these answers are recorded.", "No live Meta model has run, so these answers are recorded."],
    ["10.3", 145.0, "Real photos and Hindi speech are still to be measured.", "Real photos and Hindi speech are still to be measured."],
    ["10.4", 150.4, "The checker would sooner refuse than guess.", "The checker would sooner refuse than guess."],
    ["10.5", 154.8, "The data is synthetic, the suppliers are simulated, and money is only ever recorded.", "The data is synthetic, the suppliers are simulated, and money is only ever recorded."],
    ["11.1", 162.8, "Munshi. A back office that shows its work, and waits for a person.", "Moonshee. A back office that shows its work, and waits for a person."],
    ["11.2", 168.6, "Code and demo, linked below.", "Code and demo, linked below."],
  ];
  const duration = beats[beats.length - 1][2];
  const beat = (id) => {
    const b = beats.find((x) => x[0] === id);
    return { id, start: b[1], end: b[2], dur: b[2] - b[1] };
  };
  // A line's window: from its start to the next line's start, or its beat's end.
  const windowOf = (i) => {
    const [, at] = lines[i];
    const b = beats.find((x) => at >= x[1] && at < x[2]);
    const next = lines[i + 1] && lines[i + 1][1] < b[2] ? lines[i + 1][1] : b[2];
    return next - at;
  };
  globalThis.CLOCK = { fps: 30, width: 1920, height: 1080, duration, beats, lines, beat, windowOf, voice: "bf_emma" };
})();
