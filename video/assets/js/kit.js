// The film's motion kit (window.K). Every helper adds explicit-time tweens to the paused timeline it is given, so any
// frame renders on its own. Times are a scene's local seconds; K.at(beat, abs) converts a clock time. Screen coordinates
// are CSS px of a captured 390 x 844 screen (assets/js/spots.js).
(function () {
  const S = 1.1; // the phone's scale: 390 px of screen -> 429 px of film
  const PX = 216; // the phone's left and top in the frame (assets/css/look.css .phone)
  const PY = 54;
  const BEZEL = 12; // body border + padding before the screen

  const K = {
    S,
    tl: () => gsap.timeline({ paused: true }),
    // A scene's local time for an absolute clock time.
    at: (beatId, abs) => abs - CLOCK.beat(beatId).start,
    line: (id) => CLOCK.lines.find((l) => l[0] === id)[1],
    reg(id, tl, dur) {
      tl.set({}, {}, dur);
      window.__timelines[id] = tl;
    },
    // Where a screen point lands in the frame while the phone is at rest.
    toFrame: (x, y) => ({ x: PX + S * (BEZEL + x), y: PY + S * (BEZEL + y) }),

    // Words: wrap each word of an element in a span once, then land them one by one (blur 6 -> 0, no travel).
    split(el) {
      if (el.dataset.split) return [...el.querySelectorAll(".w")];
      const walk = (node) => {
        for (const child of [...node.childNodes]) {
          if (child.nodeType === 3) {
            const frag = document.createDocumentFragment();
            for (const part of child.textContent.split(/(\s+)/)) {
              if (!part) continue;
              if (/^\s+$/.test(part)) frag.append(document.createTextNode(part));
              else {
                const s = document.createElement("span");
                s.className = "w";
                s.textContent = part;
                frag.append(s);
              }
            }
            child.replaceWith(frag);
          } else if (child.nodeType === 1 && !child.classList.contains("w")) walk(child);
        }
      };
      walk(el);
      el.dataset.split = "1";
      return [...el.querySelectorAll(".w")];
    },
    words(tl, el, at, gap = 0.07) {
      const ws = K.split(el);
      ws.forEach((w) => tl.set(w, { opacity: 0 }, 0));
      tl.set(el, { opacity: 1 }, at);
      ws.forEach((w, i) => tl.fromTo(w, { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power2.out" }, at + i * gap));
      return at + ws.length * gap + 0.14;
    },
    // Highlighter on <mark class="hl"> inside text: a turmeric band sweeping in under the words.
    mark(tl, el, at, dur = 0.35) {
      tl.fromTo(el, { "--hl": 0 }, { "--hl": 1, duration: dur, ease: "power2.inOut" }, at);
    },
    pop(tl, el, at, dur = 0.32) {
      tl.fromTo(el, { opacity: 0, scale: 0.86, filter: "blur(5px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: dur, ease: "expo.out" }, at);
    },
    show(tl, el, at, dur = 0.3) {
      tl.fromTo(el, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: dur, ease: "power2.out" }, at);
    },
    out(tl, el, at, dur = 0.22) {
      tl.to(el, { opacity: 0, filter: "blur(6px)", duration: dur, ease: "power3.in" }, at);
    },
    // A sticker or a stamp landing: down from above the page, a hair past, settled.
    slam(tl, el, at, rot = -3) {
      tl.fromTo(el, { opacity: 0, scale: 1.45, rotation: rot - 6 }, { opacity: 1, scale: 1, rotation: rot, duration: 0.26, ease: "power4.in" }, at);
      tl.to(el, { scale: 1.03, duration: 0.06, ease: "power1.out", yoyo: true, repeat: 1 }, at + 0.26);
    },

    // The phone.
    phoneSet(tl, el) {
      tl.set(el, { scale: S, transformOrigin: "0 0" }, 0);
    },
    phoneIn(tl, el, at, from = { y: 140 }) {
      tl.fromTo(el, { opacity: 0, x: from.x ?? 0, y: from.y ?? 0, scale: S }, { opacity: 1, x: 0, y: 0, scale: S, duration: 0.7, ease: "expo.out" }, at);
    },
    phoneOut(tl, el, at, to = { y: 160 }) {
      tl.to(el, { opacity: 0, x: to.x ?? 0, y: to.y ?? 0, duration: 0.35, ease: "power3.in" }, at);
    },
    // Show one screen layer at once (the first state of a scene).
    first(tl, layer) {
      tl.set(layer, { opacity: 1, filter: "blur(0px)" }, 0);
    },
    // One screen replaces another on the same stage: the old blurs out as the new sharpens ("wipe" opens like a drawer).
    swap(tl, from, to, at, mode = "blur") {
      if (mode === "wipe") {
        tl.fromTo(to, { opacity: 1, filter: "blur(0px)", clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.38, ease: "power3.out", immediateRender: false }, at);
        if (from) tl.set(from, { opacity: 0 }, at + 0.38);
        return;
      }
      if (mode === "cut") {
        tl.set(to, { opacity: 1, filter: "blur(0px)" }, at);
        if (from) tl.set(from, { opacity: 0 }, at);
        return;
      }
      if (from) tl.to(from, { opacity: 0, filter: "blur(8px)", duration: 0.18, ease: "power2.in" }, at);
      // immediateRender off: a layer shown earlier in the scene keeps its earlier state until this swap starts.
      tl.fromTo(to, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.22, ease: "power2.out", immediateRender: false }, at + 0.08);
    },
    // Scroll a tall screen so page y `y` sits at the top of the phone.
    scroll(tl, el, y, at, dur = 0.9) {
      tl.to(el, { y: -y, duration: dur, ease: "power2.inOut" }, at);
    },
    scrollSet(tl, el, y) {
      tl.set(el, { y: -y }, 0);
    },
    // Camera inside the phone: bring a screen box to the screen's centre at `zoom` (clamped to the screen's edges).
    cam(tl, el, box, zoom, at, dur = 0.8) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const x = Math.min(0, Math.max(390 - 390 * zoom, 195 - cx * zoom));
      const y = Math.min(0, Math.max(844 - 844 * zoom, 422 - cy * zoom));
      tl.to(el, { x, y, scale: zoom, transformOrigin: "0 0", duration: dur, ease: "power2.inOut" }, at);
    },

    // Annotations, drawn into a .marks layer in screen (or page) coordinates.
    tap(tl, marks, x, y, at) {
      const t = document.createElement("div");
      t.className = "tap";
      t.style.left = `${x}px`;
      t.style.top = `${y}px`;
      marks.append(t);
      tl.fromTo(t, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.18, ease: "power2.out" }, at - 0.22);
      tl.to(t, { scale: 0.78, duration: 0.08, ease: "power2.in" }, at - 0.04);
      tl.to(t, { scale: 1, opacity: 0, duration: 0.3, ease: "power2.out" }, at + 0.06);
      return t;
    },
    // A hand-drawn red loop round a box: one stroke, 1.12 turns, a slight wobble (seeded, so every render is the same).
    circle(tl, marks, box, at, { pad = 10, width = 4, dur = 0.55, seed = 1 } = {}) {
      const rx = box.w / 2 + pad;
      const ry = box.h / 2 + pad;
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "ink");
      svg.setAttribute("width", 2 * rx + 40);
      svg.setAttribute("height", 2 * ry + 40);
      svg.style.left = `${box.x + box.w / 2 - rx - 20}px`;
      svg.style.top = `${box.y + box.h / 2 - ry - 20}px`;
      let d = "";
      const turns = 1.12;
      const n = 90;
      const a0 = -2.2 + 0.3 * Math.sin(seed * 12.9898);
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * turns * 2 * Math.PI;
        const wob = 1 + 0.035 * Math.sin(3 * a + seed) + 0.02 * Math.sin(7 * a + 2 * seed) + (i / n) * 0.05;
        const x = rx + 20 + rx * wob * Math.cos(a);
        const y = ry + 20 + ry * wob * Math.sin(a) * 1.02;
        d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      p.setAttribute("stroke-width", width);
      svg.append(p);
      marks.append(svg);
      const len = p.getTotalLength();
      // Hidden until drawn: a round cap on an undrawn stroke still paints a dot.
      tl.set(p, { opacity: 0 }, 0);
      tl.fromTo(p, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, duration: dur, ease: "power2.inOut", immediateRender: false }, at);
      return svg;
    },
    // A red hand-drawn underline under a box, drawn left to right.
    underline(tl, marks, box, at, { width = 6, dur = 0.4, seed = 1, gap = 8 } = {}) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "ink");
      svg.setAttribute("width", box.w + 40);
      svg.setAttribute("height", 40);
      svg.style.left = `${box.x - 20}px`;
      svg.style.top = `${box.y + box.h + gap - 20}px`;
      let d = "";
      for (let i = 0; i <= 40; i++) {
        const x = 20 + (i / 40) * box.w;
        const y = 20 + 3 * Math.sin(i * 0.7 + seed) + (i / 40) * 4;
        d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      p.setAttribute("stroke-width", width);
      svg.append(p);
      marks.append(svg);
      const len = p.getTotalLength();
      tl.set(p, { opacity: 0 }, 0);
      tl.fromTo(p, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, duration: dur, ease: "power2.inOut", immediateRender: false }, at);
      return svg;
    },
    // A turmeric highlighter band swept left to right over a box.
    hl(tl, marks, box, at, { dur = 0.35, pad = 3 } = {}) {
      const b = document.createElement("div");
      b.className = "hlbar";
      Object.assign(b.style, { left: `${box.x - pad}px`, top: `${box.y - pad}px`, width: `${box.w + 2 * pad}px`, height: `${box.h + 2 * pad}px` });
      marks.append(b);
      tl.fromTo(b, { scaleX: 0, opacity: 0.85 }, { scaleX: 1, duration: dur, ease: "power2.inOut" }, at);
      return b;
    },

    // Lift a crop of the current screen out of the phone to `to` (frame px, top-left) at `k` x its CSS size. `src` is
    // the screen image, `h` its CSS height, `box` the crop in its coordinates, `scrollY` how far that screen is scrolled.
    // K.back flies it home again.
    lift(tl, host, { id, src, h = 844, box, scrollY = 0, to, k, at, dur = 0.6, fly = true }) {
      // The wrapper moves; the frame inside clips the crop; the marks sit over it unclipped (a circle may overhang).
      const el = document.createElement("div");
      el.className = "lift-w";
      el.id = id;
      Object.assign(el.style, { left: `${to.x}px`, top: `${to.y}px`, width: `${box.w * k}px`, height: `${box.h * k}px` });
      const frame = document.createElement("div");
      frame.className = "lift";
      const img = document.createElement("img");
      img.src = src;
      Object.assign(img.style, { width: `${390 * k}px`, height: `${h * k}px`, left: `${-box.x * k}px`, top: `${-box.y * k}px` });
      frame.append(img);
      const marks = document.createElement("div");
      marks.className = "marks";
      Object.assign(marks.style, { width: "100%", height: "100%", overflow: "visible" });
      el.append(frame, marks);
      host.append(el);
      const from = K.toFrame(box.x, box.y - scrollY);
      const s0 = S / k;
      // fly: false leaves the entrance to the caller (a lift that does not come out of the phone).
      if (fly) {
        tl.fromTo(el, { opacity: 1, x: from.x - to.x, y: from.y - to.y, scale: s0 }, { x: 0, y: 0, scale: 1, duration: dur, ease: "expo.inOut", immediateRender: false }, at);
        tl.fromTo(frame, { boxShadow: "0px 0px 0px #1b1611" }, { boxShadow: "10px 10px 0px #1b1611", duration: dur, ease: "expo.inOut", immediateRender: false }, at);
      }
      el.k = k;
      el.box = box;
      el.marks = marks;
      el.frame = frame;
      // A screen box in the crop's own (scaled) coordinates, for marks drawn on the lift.
      el.local = (b) => ({ x: (b.x - box.x) * k, y: (b.y - box.y) * k, w: b.w * k, h: b.h * k });
      el.home = { x: from.x - to.x, y: from.y - to.y, scale: s0 };
      return el;
    },
    back(tl, el, at, dur = 0.55) {
      tl.to(el, { ...el.home, duration: dur, ease: "expo.inOut" }, at);
      tl.to(el.frame, { boxShadow: "0px 0px 0px #1b1611", duration: dur, ease: "expo.inOut" }, at);
      tl.to(el.marks, { opacity: 0, duration: 0.15 }, at);
      tl.set(el, { opacity: 0 }, at + dur);
    },
    // A lift already out (the state a previous scene ended on).
    settled(tl, el) {
      tl.set(el, { opacity: 1, x: 0, y: 0, scale: 1 }, 0);
    },
    // The app's stamp landing: the captured stamp (box `st` of screen `src`) is hidden under a paper patch until a crop
    // of it slams down on top, at `at`.
    stamp(tl, marks, src, st, at) {
      const b = { x: st.x - 3, y: st.y - 3, w: st.w + 6, h: st.h + 6 };
      K.cover(tl, marks, b, at + 0.25, { dur: 0.01 });
      const crop = document.createElement("div");
      Object.assign(crop.style, { position: "absolute", overflow: "hidden", opacity: 0, left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      const img = document.createElement("img");
      img.src = src;
      Object.assign(img.style, { position: "absolute", width: "390px", left: `${-b.x}px`, top: `${-b.y}px` });
      crop.append(img);
      marks.append(crop);
      tl.fromTo(crop, { opacity: 0, scale: 1.3, rotation: -4 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.24, ease: "power4.in" }, at);
      return crop;
    },
    // A paper patch over part of a screen (an answer not yet arrived, a stamp not yet landed), wiped away at `at`.
    cover(tl, marks, box, at, { color = "#fbf6ea", dur = 0.4 } = {}) {
      const c = document.createElement("div");
      Object.assign(c.style, { position: "absolute", left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, background: color });
      marks.append(c);
      tl.set(c, { clipPath: "inset(0% 0% 0% 0%)" }, 0);
      tl.to(c, { clipPath: "inset(100% 0% 0% 0%)", duration: dur, ease: "power2.inOut" }, at);
      return c;
    },
  };
  window.K = K;
})();
