// Munshi site kit, mock-up edition. Every merchant direction runs on these same hooks, so a re-skin is markup and CSS
// only. In the real kit the prices come from the shop's books through the API; here they sit in the markup as sample data.
(() => {
  const html = document.documentElement;
  const q = new URLSearchParams(location.search);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: the toggle still works per page */ } },
  };
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const rupees = (paise) => '₹' + inr.format(paise / 100);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let lang = 'en';
  const t = (en, hi) => (lang === 'hi' ? hi : en);

  function duration(min) {
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return t(`${m} min`, `${m} मिनट`);
    const hs = t(`${h} h`, h === 1 ? '1 घंटा' : `${h} घंटे`);
    return m ? `${hs} ${t(`${m} min`, `${m} मिनट`)}` : hs;
  }

  // Sample-data ribbon: on by default; ?ribbon=off shows the merchant's clean variant.
  if (q.get('ribbon') === 'off') html.classList.add('no-ribbon');

  function applyLang(next) {
    lang = next === 'hi' ? 'hi' : 'en';
    html.lang = lang;
    for (const el of $$('[data-hi]')) {
      if (el.dataset.en === undefined) el.dataset.en = el.textContent;
      el.textContent = lang === 'hi' ? el.dataset.hi : el.dataset.en;
    }
    for (const el of $$('[data-hi-html]')) {
      if (el.dataset.enHtml === undefined) el.dataset.enHtml = el.innerHTML;
      el.innerHTML = lang === 'hi' ? el.dataset.hiHtml : el.dataset.enHtml;
    }
    for (const el of $$('[data-hi-ph]')) {
      if (el.dataset.enPh === undefined) el.dataset.enPh = el.placeholder;
      el.placeholder = lang === 'hi' ? el.dataset.hiPh : el.dataset.enPh;
    }
    for (const el of $$('[data-hi-aria]')) {
      if (el.dataset.enAria === undefined) el.dataset.enAria = el.getAttribute('aria-label') || '';
      el.setAttribute('aria-label', lang === 'hi' ? el.dataset.hiAria : el.dataset.enAria);
    }
    for (const b of $$('[data-lang-set]')) b.setAttribute('aria-pressed', String(b.dataset.langSet === lang));
    store.set('munshi-site-lang', lang);
    refresh();
  }
  for (const b of $$('[data-lang-set]')) b.addEventListener('click', () => applyLang(b.dataset.langSet));

  // Chips: real radio inputs. A chip may carry CSS variables for the drawing (data-vars) and a label for the message.
  function chipLabel(input) {
    return lang === 'hi' ? input.dataset.hiLabel || input.value : input.dataset.label || input.value;
  }
  function applyVars(scope) {
    for (const input of $$('input[data-vars]:checked', scope)) {
      for (const art of $$('[data-art]', scope)) {
        for (const pair of input.dataset.vars.split(';')) {
          const [k, v] = pair.split(':');
          if (k && v) art.style.setProperty(k.trim(), v.trim());
        }
      }
    }
  }

  // "Ask on WhatsApp": wa.me with no number until the shop's number arrives; the message fills from the chosen chips.
  function waMessage(a) {
    const scope = a.closest('[data-wa-scope]') || document;
    let msg = lang === 'hi' ? a.dataset.waHi : a.dataset.waEn;
    msg = msg.replace(/\{(\w+)\}/g, (_, name) => {
      const picked = scope.querySelector(`input[name="${name}"]:checked`);
      return picked ? chipLabel(picked) : '';
    });
    return msg;
  }
  function refreshWa() {
    for (const a of $$('a[data-wa]')) {
      const msg = waMessage(a);
      a.href = 'https://wa.me/?text=' + encodeURIComponent(msg);
      const scope = a.closest('[data-wa-scope]');
      const preview = scope && scope.querySelector('[data-wa-preview]');
      if (preview) preview.textContent = msg;
    }
  }
  function refreshPicked() {
    for (const out of $$('[data-picked]')) {
      const input = document.querySelector(`input[name="${out.dataset.picked}"]:checked`);
      if (input) out.textContent = chipLabel(input);
    }
  }
  document.addEventListener('change', (e) => {
    if (e.target.matches('input[type=radio], input[type=checkbox]')) {
      applyVars(e.target.closest('[data-wa-scope]') || document);
      refreshPicked();
      refreshWa();
    }
  });

  // Catalogue filters: kind of suit and budget band. Suit A also reprints the bag in the kind's colour.
  const filter = { cat: 'all', band: 'all' };
  function applyFilter() {
    const scope = document.querySelector('[data-filter-scope]');
    if (!scope) return;
    let shown = 0;
    for (const item of $$('[data-cat]', scope)) {
      const ok = (filter.cat === 'all' || item.dataset.cat === filter.cat) &&
        (filter.band === 'all' || item.dataset.band === filter.band);
      item.hidden = !ok;
      if (ok) shown++;
    }
    const mark = (b, on) => b.setAttribute(b.tagName === 'A' ? 'aria-current' : 'aria-pressed', String(on));
    for (const b of $$('[data-filter-cat]')) mark(b, b.dataset.filterCat === filter.cat);
    for (const b of $$('[data-filter-band]')) mark(b, b.dataset.filterBand === filter.band);
    for (const c of $$('[data-filter-count]')) c.textContent = t(`${shown} pieces`, `${shown} पीस`);
    for (const e of $$('[data-filter-empty]')) e.hidden = shown > 0;
    for (const g of $$('[data-filter-group]')) g.hidden = !$$('[data-cat]', g).some((i) => !i.hidden);
    html.dataset.bag = filter.cat;
  }
  for (const b of $$('[data-filter-cat]')) b.addEventListener('click', () => { filter.cat = b.dataset.filterCat; applyFilter(); });
  for (const b of $$('[data-filter-band]')) b.addEventListener('click', () => { filter.band = b.dataset.filterBand; applyFilter(); });

  // Salon: pick services into a tray, then carry them to the booking request as ?s=ids.
  const picked = new Set();
  function refreshTray() {
    const tray = document.querySelector('[data-tray]');
    if (!tray) return;
    const chosen = $$('[data-svc]').filter((b) => picked.has(b.dataset.svc));
    const unique = new Map(chosen.map((b) => [b.dataset.svc, b]));
    let min = 0, paise = 0;
    for (const b of unique.values()) { min += Number(b.dataset.min); paise += Number(b.dataset.paise); }
    tray.dataset.count = String(unique.size);
    for (const el of $$('[data-tray-count]')) {
      el.textContent = unique.size ? t(`${unique.size} picked`, `${unique.size} चुनी गईं`) : t('Nothing picked yet', 'अभी कुछ नहीं चुना');
    }
    for (const el of $$('[data-tray-time]')) el.textContent = unique.size ? duration(min) : '';
    for (const el of $$('[data-tray-total]')) el.textContent = unique.size ? rupees(paise) : '';
    for (const a of $$('a[data-tray-go]')) {
      a.href = 'booking.html' + (unique.size ? '?s=' + Array.from(unique.keys()).join(',') : '');
    }
    for (const b of $$('[data-svc]')) b.setAttribute('aria-pressed', String(picked.has(b.dataset.svc)));
  }
  for (const b of $$('[data-svc]')) {
    b.addEventListener('click', () => {
      picked.has(b.dataset.svc) ? picked.delete(b.dataset.svc) : picked.add(b.dataset.svc);
      refreshTray();
    });
  }
  for (const id of (q.get('pick') || '').split(',').filter(Boolean)) picked.add(id);

  function refreshDurations() {
    for (const el of $$('[data-dur]')) el.textContent = duration(Number(el.dataset.dur));
  }

  // Booking request: validates, then shows what would be sent. Nothing leaves the page in the mock-up.
  const form = document.querySelector('form[data-booking]');
  const label = (input) => {
    const l = form.querySelector(`label[for="${input.id}"]`);
    if (!l) return input.value;
    const n = l.querySelector('[data-name]');
    const text = n ? n.textContent : Array.from(l.children).map((c) => c.textContent).join(' ');
    return text.trim().replace(/\s+/g, ' ');
  };
  function refreshSummary() {
    const box = document.querySelector('[data-summary]');
    if (!box || !form) return;
    const picked = $$('input[name="svc"]:checked', form);
    let min = 0, paise = 0;
    const rows = picked.map((i) => {
      min += Number(i.dataset.min); paise += Number(i.dataset.paise);
      const li = document.createElement('li');
      const name = document.createElement('span'); name.textContent = label(i);
      const fig = document.createElement('b'); fig.textContent = rupees(Number(i.dataset.paise));
      li.append(name, fig);
      return li;
    });
    box.querySelector('[data-sum-list]').replaceChildren(...rows);
    box.querySelector('[data-sum-empty]').hidden = picked.length > 0;
    box.querySelector('[data-sum-total]').textContent = picked.length ? `${duration(min)} · ${rupees(paise)}` : '';
  }
  if (form) {
    form.addEventListener('change', refreshSummary);
    for (const id of (q.get('s') || '').split(',').filter(Boolean)) {
      const box = form.querySelector(`input[name="svc"][value="${CSS.escape(id)}"]`);
      if (box) {
        box.checked = true;
        box.closest('details')?.setAttribute('open', '');
      }
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const errs = {};
      if (!form.elements.name.value.trim()) errs.name = true;
      const digits = form.elements.phone.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
      if (!/^[6-9]\d{9}$/.test(digits)) errs.phone = true;
      if (!form.querySelector('input[name="svc"]:checked')) errs.svc = true;
      if (!form.querySelector('input[name="day"]:checked')) errs.day = true;
      if (!form.querySelector('input[name="window"]:checked')) errs.window = true;
      for (const el of $$('[data-err-for]', form)) el.hidden = !errs[el.dataset.errFor];
      for (const field of ['name', 'phone']) form.elements[field].setAttribute('aria-invalid', String(!!errs[field]));
      const first = Object.keys(errs)[0];
      if (first) {
        const target = form.querySelector(`[name="${first}"]`);
        if (target) target.focus();
        return;
      }
      const done = document.querySelector('[data-booking-done]');
      done.querySelector('[data-done-services]').textContent =
        $$('input[name="svc"]:checked', form).map(label).join(' · ');
      done.querySelector('[data-done-when]').textContent =
        `${label(form.querySelector('input[name="day"]:checked'))} · ${label(form.querySelector('input[name="window"]:checked'))}`;
      done.querySelector('[data-done-consent]').textContent = form.elements.consent.checked
        ? t('Yes, WhatsApp updates', 'हाँ, WhatsApp अपडेट')
        : t('No WhatsApp updates', 'WhatsApp अपडेट नहीं');
      done.hidden = false;
      done.scrollIntoView({ block: 'start' });
      done.focus();
    });
  }

  function refresh() {
    refreshDurations();
    applyFilter();
    refreshTray();
    refreshPicked();
    refreshWa();
    refreshSummary();
  }

  for (const scope of $$('[data-wa-scope]')) applyVars(scope);
  applyLang(q.get('lang') || store.get('munshi-site-lang') || 'en');
})();
