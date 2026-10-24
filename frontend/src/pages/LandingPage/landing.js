// The landing page's behaviour, ported from landing-drafts/v4: the sky, the header, the arrivals and each section's
// little demo. startLanding runs on a fresh copy of the markup and returns a cleanup that removes every window and
// document listener, timer, frame loop and observer it made, so leaving the page (or React's dev double-mount) leaves nothing behind.
export function startLanding(root) {
  let dead = false;
  const ac = new AbortController(), sig = { signal: ac.signal };
  const timers = new Set(), observers = [];
  const later_ = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const raf = (fn) => (dead ? 0 : requestAnimationFrame(fn));
  const IO = class extends IntersectionObserver { constructor(...a) { super(...a); observers.push(this); } };
  const RO = class extends ResizeObserver { constructor(...a) { super(...a); observers.push(this); } };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The app's own sky: drifting points, a few of them coral, joined when they come close
  (() => {
    const cv = document.getElementById('sky'), ctx = cv.getContext('2d');
    let W, H, nodes = [], dpr = 1;
    const make = (w, h, sp) => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * sp, vy: (Math.random() - .5) * sp, r: Math.random() * 1.2 + .5, accent: Math.random() < .2 });
    function size(){
      dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(15, Math.min(50, Math.round(W * H / 35000))), sp = W < 768 ? .28 : .5;
      while (nodes.length < n) nodes.push(make(W, H, sp)); nodes.length = n;
    }
    addEventListener('resize', size, sig); size();
    function tick(){
      const maxD = W < 768 ? 115 : 165;
      ctx.clearRect(0, 0, W, H);
      for (const p of nodes) {
        if (!reduce) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; }
        ctx.fillStyle = p.accent ? 'rgba(255,107,107,.5)' : 'rgba(244,234,220,.3)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < maxD) { const o = 1 - d / maxD; ctx.lineWidth = .75; ctx.strokeStyle = (a.accent || b.accent) ? `rgba(255,107,107,${o * .65})` : `rgba(244,234,220,${o * .35})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      raf(tick);
    }
    tick();
  })();

  // Header lifts into glass once the page moves
  const hdr = document.getElementById('hdr');
  let lastY = scrollY, ticking = false;
  function onScroll(){
    ticking = false;
    const y = Math.max(0, scrollY), dy = y - lastY;
    hdr.classList.toggle('lifted', y > 10);
    if (y < 120 || dy < -6) hdr.classList.remove('away');
    else if (dy > 6 && !hdr.contains(document.activeElement)) hdr.classList.add('away');
    if (Math.abs(dy) > 6) lastY = y;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; raf(onScroll); } }, { signal: ac.signal, passive: true });
  onScroll();

  // Reveal on arrival (normal scrolling, nothing pinned)
  const io = new IO((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
  // the hero is always on the first screen: it plays on load (a frame later, so the rise is seen), not by the scroll trigger,
  // whose bottom margin would leave a short phone's buttons hidden until someone scrolls
  const heroRv = root.querySelectorAll('.hero .rv');
  raf(() => raf(() => heroRv.forEach((el) => el.classList.add('in'))));
  root.querySelectorAll('.rv').forEach((el) => { if (!el.closest('.hero')) io.observe(el); });
  // Arrivals: play a picture once, when it's well in view; with reduced motion, go straight to its end state
  const arrive = (el, play, th = .35) => {
    if (reduce) return play(true);
    const o = new IO(([e]) => { if (e.isIntersecting) { o.disconnect(); play(false); } }, { threshold: th });
    o.observe(el);
  };
  const later = (now, ms, fn) => (now ? fn() : later_(fn, ms));


  // Ask: fine lines from the answer to the notes it used, drawn when the section arrives
  (() => {
    const box = document.getElementById('ask'), svg = document.getElementById('threads'), NS = 'http://www.w3.org/2000/svg';
    function draw(){
      svg.innerHTML = '';
      const b = box.getBoundingClientRect(), a = document.getElementById('ans').getBoundingClientRect();
      for (const id of ['c1', 'c2']) {
        const c = document.getElementById(id).getBoundingClientRect();
        const x1 = a.left - b.left + a.width * (id === 'c1' ? .3 : .78), y1 = a.bottom - b.top;
        const x2 = c.left - b.left + c.width * .5, y2 = c.top - b.top;
        const p = document.createElementNS(NS, 'path'); p.dataset.for = id;
        const midY = (y1 + y2) / 2;
        p.setAttribute('d', `M${x1} ${y1} C${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`);
        svg.appendChild(p);
        const len = p.getTotalLength(); p.style.setProperty('--len', len);
        for (const [x, y, end] of [[x1, y1], [x2, y2, true]]) { const c0 = document.createElementNS(NS, 'circle'); c0.setAttribute('cx', x); c0.setAttribute('cy', y); c0.setAttribute('r', 3.2); if (end) c0.classList.add('end'); svg.appendChild(c0); }
      }
    }
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { if (!dead) draw(); });
    addEventListener('resize', draw, sig);
    // arrival: the question, Quill typing, its answer, the notes it used, then the threads to them
    arrive(box, (now) => [['in', 0], ['typing', 100], ['said', 350], ['cited', 600], ['linked', 950]].forEach(([c, ms]) => later(now, ms, () => box.classList.add(c))), .5);
    // light one source: the card, its thread and the words of the answer it backs
    const light = (id) => {
      for (const c of ['c1', 'c2']) document.getElementById(c).classList.toggle('lit', c === id);
      box.querySelectorAll('#ans [data-src]').forEach((e) => e.classList.toggle('lit', e.dataset.src === id));
      svg.querySelectorAll('path').forEach((p) => { p.classList.toggle('lit', p.dataset.for === id); p.classList.toggle('dim', !!id && p.dataset.for !== id); });
    };
    for (const id of ['c1', 'c2']) {
      const c = document.getElementById(id);
      c.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') light(id); }, sig);
      c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') light(null); }, sig);
      c.addEventListener('focus', () => { if (c.matches(':focus-visible')) light(id); }, sig); c.addEventListener('blur', () => light(null), sig);
      c.addEventListener('click', (e) => { if (e.pointerType !== 'mouse') light(c.classList.contains('lit') ? null : id); }, sig);
    }
    document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' && !e.target.closest('.cite')) light(null); }, sig);
  })();

  // Your yes: ticks, apply, undo from the dock
  (() => {
    const sheet = document.getElementById('sheet'), ticks = [...sheet.querySelectorAll('.row .tk')], count = document.getElementById('count'), apply = document.getElementById('apply');
    const toast = document.getElementById('toast'), tTxt = document.getElementById('toastTxt');
    const n = () => ticks.filter((t) => t.getAttribute('aria-checked') === 'true').length;
    const pl = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    const refresh = () => { const k = n(); count.textContent = `${pl(k, 'change')}, ${pl(k, 'note')}`; apply.textContent = k ? `Apply to ${pl(k, 'note')}` : 'Nothing ticked'; apply.style.opacity = k ? 1 : .5; };
    ticks.forEach((t) => t.addEventListener('click', () => { t.setAttribute('aria-checked', String(t.getAttribute('aria-checked') !== 'true')); refresh(); }, sig));
    let timer;
    const show = (text) => { tTxt.textContent = text; toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show'); clearTimeout(timer); timer = later_(() => toast.classList.remove('show'), 5000); };
    let leaving;
    apply.addEventListener('click', () => {
      const k = n(); if (!k || sheet.classList.contains('archiving')) return;
      document.getElementById('doneTxt').textContent = `Done. ${pl(k, 'note')} archived.`;
      let j = 0; ticks.forEach((t) => { const r = t.closest('.row'), go = t.getAttribute('aria-checked') === 'true'; r.classList.toggle('go', go); if (go) r.style.setProperty('--j', j++); });
      sheet.classList.add('archiving');
      leaving = later_(() => { sheet.classList.add('applied'); show(`Archived ${pl(k, 'note')}`); }, reduce ? 0 : 300 + (k - 1) * 70);
    }, sig);
    const undo = () => { if (!sheet.classList.contains('applied')) return; clearTimeout(leaving); sheet.classList.remove('applied', 'archiving'); show('Undone. Notes are back.'); };
    document.getElementById('undo').addEventListener('click', undo, sig);
    document.getElementById('discard').addEventListener('click', () => { ticks.forEach((t) => t.setAttribute('aria-checked', 'false')); refresh(); }, sig);
    // arrival: Quill lays out each suggestion and ticks it as it lands, then offers Apply (the card's size never changes)
    const rows = ticks.map((t) => t.closest('.row'));
    if (!reduce) { ticks.forEach((t) => t.setAttribute('aria-checked', 'false')); refresh(); count.textContent = 'Looking through your notes…'; }
    arrive(sheet, (now) => {
      rows.forEach((r, i) => {
        later(now, 300 + i * 340, () => r.classList.add('shown'));
        later(now, 300 + i * 340 + 280, () => { ticks[i].setAttribute('aria-checked', 'true'); refresh(); });
      });
      later(now, 300 + rows.length * 340 + 200, () => sheet.classList.add('ready'));
    }, .6);
  })();

  // The graph, drawn as Quill's Graph page draws it: cream nodes, faint white links between notes that share a tag,
  // a small force simulation, dragging, hover and the tag filter
  (() => {
    const NOTES = [
      ['Packing list', ['travel']], ['Train tickets', ['travel']], ['Lisbon in May', ['travel']], ['Leeds weekend', ['travel', 'home']],
      ['Thesis, chapter 2', ['college']], ['Supervisor meeting', ['college']], ['Reading for Tuesday', ['college', 'books']], ['Reading list', ['books']],
      ['Weekend', ['home']], ['Fridge right now', ['home', 'recipes']], ['Lemon pasta', ['recipes']], ['Dal tadka', ['recipes']],
    ].map(([name, tags], i) => ({ id: i, name, tags, x: 0, y: 0, vx: 0, vy: 0, op: 1, rad: 9 }));
    const LINKS = [];
    NOTES.forEach((a, i) => NOTES.slice(i + 1).forEach((b) => { const sh = a.tags.filter((t) => b.tags.includes(t)); if (sh.length) LINKS.push({ a, b, sh, op: .2 }); }));
    const TAGS = [...new Set(NOTES.flatMap((n) => n.tags))];
    const box = document.getElementById('graph'), cv = document.getElementById('gcv'), ctx = cv.getContext('2d');
    let W, H, dpr, scale, maxScale, cx = 0, cy = 0, tag = null, hover = null, drag = null, alpha = 1;
    const lerp = (a, b, t) => a + (b - a) * t;
    function size(){ dpr = Math.min(devicePixelRatio || 1, 2); W = box.clientWidth; H = box.clientHeight; cv.width = W * dpr; cv.height = H * dpr; maxScale = innerWidth < 640 ? 2 : 2.4; scale = scale || maxScale; }
    new RO(() => { size(); alpha = Math.max(alpha, .3); }).observe(box); size();
    // start each note near the others of its first tag, so the layout settles untangled (graph units; the canvas is drawn zoomed, as the app's view is)
    NOTES.forEach((n, i) => { const g = TAGS.indexOf(n.tags[0]), a = g / TAGS.length * 6.283, j = i * 2.39996; const sx = innerWidth < 640 ? 40 : 90, sy = innerWidth < 640 ? 120 : 90; n.x = Math.cos(a) * sx + Math.cos(j) * 14; n.y = Math.sin(a) * sy + Math.sin(j) * 14; });
    // the app's forces: charge -50 (-40 phone), links 50 long (45) at strength 1, a gentle pull to the centre, collision 16
    function step(){
      const phone = innerWidth < 640, charge = phone ? -40 : -50, dist = phone ? 45 : 50, centre = phone ? .035 : .06, cxk = phone ? .055 : centre, cyk = phone ? .025 : centre;
      for (let i = 0; i < NOTES.length; i++) for (let j = i + 1; j < NOTES.length; j++) {
        const a = NOTES[i], b = NOTES[j]; let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2);
        const fr = charge * alpha / d2; a.vx += dx * fr; a.vy += dy * fr; b.vx -= dx * fr; b.vy -= dy * fr;
        if (d < 46) { const push = (46 - d) / d * .5; a.vx -= dx * push * .5; a.vy -= dy * push * .5; b.vx += dx * push * .5; b.vy += dy * push * .5; }
      }
      for (const l of LINKS) { const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1, k = (d - dist) / d * alpha * .5 / Math.min(degree(l.a), degree(l.b)); l.a.vx += dx * k; l.a.vy += dy * k; l.b.vx -= dx * k; l.b.vy -= dy * k; }
      const ax = W / scale / 2 * 0, ay = 0;
      for (const n of NOTES) { n.vx += (ax - n.x) * cxk * alpha; n.vy += (ay - n.y) * cyk * alpha; if (n === drag) { n.vx = n.vy = 0; continue; } n.vx *= .6; n.vy *= .6; n.x += n.vx; n.y += n.vy; }
      alpha = Math.max(alpha * .985, drag ? .3 : .002);
    }
    const deg = new Map(); const degree = (n) => deg.get(n) || 1;
    LINKS.forEach((l) => { deg.set(l.a, (deg.get(l.a) || 0) + 1); deg.set(l.b, (deg.get(l.b) || 0) + 1); });
    for (let i = 0; i < 300; i++) step();
    alpha = .02; fit(true);
    // arrival: the constellation forms. Each tag's notes spread out from the middle to where the layout above settled them,
    // one group after another, overshooting a touch; links fade in as both their ends arrive, labels last
    const FIN = NOTES.map((n) => [n.x, n.y]), mid = [0, 1].map((k) => FIN.reduce((s, p) => s + p[k], 0) / FIN.length);
    const inGroup = {};
    NOTES.forEach((n) => { const g = TAGS.indexOf(n.tags[0]); inGroup[g] = inGroup[g] || 0; n.delay = g * 150 + inGroup[g]++ * 70; n.ap = n.la = reduce ? 1 : 0; });
    let born = null, intro = !reduce;
    const back = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2, clamp = (v) => Math.min(1, Math.max(0, v));
    function introStep(){
      if (born === null) return;
      const t = performance.now() - born; let done = true;
      NOTES.forEach((n, i) => {
        const p = clamp((t - n.delay) / 1300), e = .1 + .9 * back(p);
        n.x = mid[0] + (FIN[i][0] - mid[0]) * e; n.y = mid[1] + (FIN[i][1] - mid[1]) * e;
        n.ap = clamp((t - n.delay) / 420); n.la = clamp((t - n.delay - 650) / 450);
        if (p < 1 || n.la < 1) done = false;
      });
      if (done) { intro = false; NOTES.forEach((n) => { n.vx = n.vy = 0; }); }
    }
    arrive(box, () => { born = performance.now(); }, .4);
    const toScreen = (n) => [W / 2 + (n.x - cx) * scale, H / 2 + (n.y - cy) * scale];
    // what each note says, for the card a click opens
    const BODY = {
      'Packing list': 'Adapter, sunscreen, the good walking shoes.', 'Train tickets': '08:12, coach C, seat 41. Return open.',
      'Lisbon in May': 'Flights are cheapest on a Tuesday. Two nights in Alfama.', 'Leeds weekend': 'Staying with Priya near Hyde Park. Market on Saturday.',
      'Thesis, chapter 2': 'Lead with the field notes from weeks three to six.', 'Supervisor meeting': 'Thursday at three. Bring the new outline.',
      'Reading for Tuesday': 'Middlemarch, chapters 4 to 6.', 'Reading list': 'Middlemarch, The Overstory, Thinking in Systems.',
      'Weekend': 'Book the train to Leeds. Return the library books.', 'Fridge right now': 'Half a lemon, spinach, yoghurt, two eggs.',
      'Lemon pasta': 'Zest both lemons before you juice them.', 'Dal tadka': 'The tadka goes in last: ghee, cumin, garlic.',
    };
    const card = document.getElementById('gcard');
    let sel = null;
    function open(n){
      sel = n;
      if (!n) { card.classList.remove('open'); return; }
      card.innerHTML = `<h4>${n.name}</h4><p>${BODY[n.name] || ''}</p><div class="tg">${n.tags.map((t) => `<span>#${t}</span>`).join('')}</div>`;
      place(); card.classList.add('open');
    }
    // on the side of the point away from the notes it's joined to, so the card never hides them; kept inside the graph
    function place(){
      if (!sel) return;
      const [sx, sy] = toScreen(sel), w = card.offsetWidth, h = card.offsetHeight, gap = 16 * scale;
      // a phone's graph fills the width, so there is no free side: the card opens just under the graph instead
      if (innerWidth < 640) { card.style.transform = `translate(${(W - w) / 2}px,${H + 10}px)`; return; }
      let mx = 0, my = 0;
      LINKS.forEach((l) => { const o = l.a === sel ? l.b : l.b === sel ? l.a : null; if (o) { mx += o.x - sel.x; my += o.y - sel.y; } });
      // try each side, the one facing away from its notes first, and take the first that covers none of the lit points
      const right = [sx + gap, sy - h / 2], left = [sx - gap - w, sy - h / 2], below = [sx - w / 2, sy + gap + 8 * scale], above = [sx - w / 2, sy - gap - h];
      const sides = Math.abs(mx) >= Math.abs(my) ? (mx > 0 ? [left, right, below, above] : [right, left, below, above]) : (my > 0 ? [above, below, right, left] : [below, above, right, left]);
      const lit = [sel]; LINKS.forEach((l) => { if (l.a === sel) lit.push(l.b); if (l.b === sel) lit.push(l.a); });
      const pad = 10, x0 = innerWidth < 640 ? 0 : -60;
      let best = null, bestHits = Infinity;
      for (const [px, py] of sides) {
        const x = Math.max(x0, Math.min(W - w, px)), y = Math.max(0, Math.min(H - h, py));
        const hits = lit.filter((n) => { const [nx, ny] = toScreen(n); return nx > x - pad && nx < x + w + pad && ny > y - pad && ny < y + h + pad; }).length;
        if (hits < bestHits) { best = [x, y]; bestHits = hits; if (!hits) break; }
      }
      card.style.transform = `translate(${best[0]}px,${best[1]}px)`;
    }
    function highlighted(){
      const f = hover || sel;
      if (f) { const s2 = new Set([f]); LINKS.forEach((l) => { if (l.a === f) s2.add(l.b); if (l.b === f) s2.add(l.a); }); return s2; }
      if (tag) return new Set(NOTES.filter((n) => n.tags.includes(tag)));
      return new Set();
    }
    function fit(snap){
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of NOTES) { x0 = Math.min(x0, n.x - 40); x1 = Math.max(x1, n.x + 40); y0 = Math.min(y0, n.y - 14); y1 = Math.max(y1, n.y + 24); }
      const top = 56, ts = Math.max(maxScale * .6, Math.min(maxScale, W / (x1 - x0), (H - top) / (y1 - y0))), tx = (x0 + x1) / 2, ty = (y0 + y1) / 2 - top / 2 / ts;
      const k = snap ? 1 : .06; scale = lerp(scale, ts, k); cx = lerp(cx, tx, k); cy = lerp(cy, ty, k);
    }
    function frame(){
      if (intro) introStep(); else { step(); if (!drag) fit(false); }
      const hl = highlighted(), has = hl.size > 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
      for (const l of LINKS) {
        const f = hover || sel, lit = has && (f ? (l.a === f || l.b === f) : l.sh.includes(tag));
        const target = has ? (lit ? .8 : .02) : .2; l.op = has ? lerp(l.op, target, .15) : .2;
        ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y);
        const lo = l.op * Math.min(l.a.ap, l.b.ap);
        ctx.strokeStyle = lit ? `rgba(232,93,86,${lo})` : `rgba(255,255,255,${lo})`; ctx.lineWidth = lit ? 3.5 : .8; ctx.stroke();
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = innerWidth < 640 ? '6px Sans-Serif' : '5px Sans-Serif'; // a size up on phones, where the view can't zoom as far
      for (const n of NOTES) {
        const isH = hl.has(n), isHov = hover === n || sel === n;
        n.op = has ? lerp(n.op, isH ? 1 : .08, .15) : 1; n.rad = lerp(n.rad, isHov ? 12 : 9, .15);
        ctx.beginPath(); ctx.arc(n.x, n.y, n.rad * (.45 + .55 * n.ap), 0, 6.283);
        ctx.fillStyle = isHov ? `rgba(232,93,86,${n.op})` : `rgba(248,236,220,${n.op * n.ap})`; ctx.fill();
        const ta = has ? (isHov ? n.op : isH ? n.op * .85 : n.op * .5) : .8;
        ctx.fillStyle = `rgba(255,255,255,${ta * n.la})`; ctx.fillText(n.name, n.x, n.y + n.rad + 2);
      }
      ctx.restore();
      place();
      if (onScreen) raf(frame); else looping = false;
    }
    // draw only while the graph is on screen (or nearly): no work, and no battery, for a picture nobody can see
    let onScreen = true, looping = true;
    new IO(([e]) => { onScreen = e.isIntersecting; if (onScreen && !looping) { looping = true; raf(frame); } }, { rootMargin: '150px 0px' }).observe(box);
    raf(frame);
    // pointer: hover a node, drag it around
    const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - W / 2) / scale + cx, (e.clientY - r.top - H / 2) / scale + cy]; };
    const find = (x, y) => { let best = null, bd = 28 / scale; for (const n of NOTES) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } } return best; };
    cv.addEventListener('pointermove', (e) => { if (intro) return; const [x, y] = at(e); if (drag) { drag.x = x; drag.y = y; alpha = Math.max(alpha, .3); return; } hover = find(x, y); cv.style.cursor = hover ? 'grab' : 'default'; }, sig);
    let down = null;
    // a finger on a note drags it; a finger anywhere else scrolls the page as usual (the graph is most of a phone's screen)
    cv.addEventListener('touchstart', (e) => { if (intro) return; const t = e.touches[0], r = cv.getBoundingClientRect(); if (e.touches.length === 1 && find((t.clientX - r.left - W / 2) / scale + cx, (t.clientY - r.top - H / 2) / scale + cy)) e.preventDefault(); }, { signal: ac.signal, passive: false });
    // a mouse press on the background lets go at once; a touch waits for the lift, so a scroll that starts there keeps the card open
    const clear = () => { open(null); if (tag) setTag(null); };
    cv.addEventListener('pointerdown', (e) => { if (intro) return; const [x, y] = at(e); const n = find(x, y); if (!n) { if (e.pointerType === 'mouse') clear(); else down = [e.clientX, e.clientY, null]; return; } drag = hover = n; down = [e.clientX, e.clientY, n]; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; }, sig);
    // a press that barely moved is a click: it opens that note's card, or closes it if it's open
    const end = (e) => {
      if (down && e.type === 'pointerup' && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { if (down[2]) open(sel === down[2] ? null : down[2]); else clear(); }
      down = null; drag = null; if (e.pointerType !== 'mouse') hover = null; cv.style.cursor = hover ? 'grab' : 'default';
    };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel) open(null); }, sig);
    cv.addEventListener('pointerup', end, sig); cv.addEventListener('pointercancel', end, sig);
    cv.addEventListener('pointerleave', () => { if (!drag) hover = null; }, sig);
    // the tag filter: a round tag button that opens the list; a chosen tag becomes a pill with a close button
    const fl = document.getElementById('gfilter');
    const TAGICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m21.41 11.58-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42M5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7"/></svg>';
    function setTag(t){ tag = t; open(null); render(); }
    function render(){
      fl.innerHTML = '';
      if (tag) {
        const p = document.createElement('div'); p.className = 'gbtn pill'; p.innerHTML = `<i></i>#${tag}<button type="button" aria-label="Clear tag filter"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
        p.querySelector('button').onclick = () => setTag(null); fl.appendChild(p); return;
      }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gbtn icon'; b.title = 'Filter by Tag'; b.innerHTML = TAGICON; b.setAttribute('aria-expanded', 'false');
      const m = document.createElement('div'); m.className = 'gmenu';
      TAGS.forEach((t) => { const it = document.createElement('button'); it.type = 'button'; it.innerHTML = `#${t}<span>${NOTES.filter((n) => n.tags.includes(t)).length}</span>`; it.onclick = () => setTag(t); m.appendChild(it); });
      b.onclick = (e) => { e.stopPropagation(); const open = !m.classList.contains('open'); m.classList.toggle('open', open); b.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open)); };
      document.addEventListener('pointerdown', (e) => { if (!fl.contains(e.target)) { m.classList.remove('open'); b.classList.remove('open'); } }, { signal: ac.signal, once: false });
      fl.appendChild(b); fl.appendChild(m);
    }
    render();
  })();

  // Notes wall: checklists tick, as on a card in the app
  root.querySelectorAll('.ck').forEach((c) => c.addEventListener('click', () => c.setAttribute('aria-checked', String(c.getAttribute('aria-checked') !== 'true')), sig));
  // Notes wall arrival: the cards are set down one after another, then someone ticks off an item
  (() => {
    const wall = root.querySelector('.wall'), cards = [...wall.querySelectorAll('.nc')];
    cards.forEach((c, i) => { c.style.setProperty('--k', i); c.style.setProperty('--tilt', `${i % 2 ? 1.6 : -1.4}deg`); });
    let touched = false;
    wall.addEventListener('pointerdown', () => { touched = true; }, { signal: ac.signal, once: true });
    arrive(wall, (now) => {
      wall.classList.add('in');
      const ck = cards[1].querySelectorAll('.ck')[1];
      if (!now) later_(() => { if (!touched && ck.getAttribute('aria-checked') === 'false') ck.click(); }, 1400 + cards.length * 75);
    }, .3);
  })();
  // Notes wall: each card's ⋮ opens the app's menu for a note on Home (Folder, Archive, Trash)
  (() => {
    const ICON = {
      more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
      folder: 'M9.17 6l2 2H20v10H4V6h5.17M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
      archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.81.97H5.44l.8-.97zM5 19V8h14v11H5zm8.45-9h-2.9v3H8l4 4 4-4h-2.55z',
      trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    };
    const svg = (d, z) => `<svg width="${z}" height="${z}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
    let openCard = null;
    const close = () => { if (!openCard) return; openCard.classList.remove('menu-open'); openCard.querySelector('.nmenu').classList.remove('open'); openCard.querySelector('.more').setAttribute('aria-expanded', 'false'); openCard = null; };
    root.querySelectorAll('.wall .nc').forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'more'; b.title = 'Note options'; b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.innerHTML = svg(ICON.more, 20);
      const m = document.createElement('div'); m.className = 'nmenu'; m.setAttribute('role', 'menu');
      m.innerHTML = [['Folder', 'folder'], ['Archive', 'archive'], ['Trash', 'trash', 'danger']].map(([label, ic, v]) => `<button type="button" role="menuitem" class="${v || ''}"><span>${label}</span>${svg(ICON[ic], 14)}</button>`).join('');
      m.querySelectorAll('button').forEach((x) => x.addEventListener('click', close, sig));
      b.addEventListener('click', (e) => { e.stopPropagation(); const was = openCard === c; close(); if (was) return; openCard = c; c.classList.add('menu-open'); m.classList.add('open'); b.setAttribute('aria-expanded', 'true');
        // kept on screen: a left-hand card's menu (wider on touch) would otherwise run off the left edge
        m.style.marginRight = ''; const left = m.getBoundingClientRect().left;
        if (left < 12) m.style.marginRight = `${-(12 - left) / (parseFloat(getComputedStyle(m).zoom) || 1)}px`; }, sig);
      c.append(b, m);
    });
    document.addEventListener('pointerdown', (e) => { if (openCard && !e.target.closest('.nmenu, .more')) close(); }, sig);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, sig);
    // a turned phone or resized window moves the card from under its menu; close it (height alone changes as a phone's address bar hides)
    let lastW = innerWidth; addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; close(); } }, sig);
  })();
  // Notes wall: pick a tag and only its notes stay lit; pick it again, or anywhere else, to let go
  (() => {
    const wall = root.querySelector('.wall'), chips = [...wall.querySelectorAll('.tgs span')];
    let tag = null;
    const pick = (t) => {
      tag = t; wall.classList.toggle('picking', !!t);
      wall.querySelectorAll('.nc').forEach((c) => c.classList.toggle('match', !!t && [...c.querySelectorAll('.tgs span')].some((x) => x.textContent === t)));
      chips.forEach((x) => { x.classList.toggle('on', x.textContent === t); x.setAttribute('aria-pressed', String(x.textContent === t)); });
    };
    chips.forEach((x) => {
      x.setAttribute('role', 'button'); x.tabIndex = 0; x.setAttribute('aria-pressed', 'false');
      x.addEventListener('click', (e) => { e.stopPropagation(); pick(tag === x.textContent ? null : x.textContent); }, sig);
      x.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); x.click(); } }, sig);
    });
    document.addEventListener('pointerdown', (e) => { if (tag && !e.target.closest('.tgs span')) pick(null); }, sig);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tag) pick(null); }, sig);
  })();

  return () => { dead = true; ac.abort(); timers.forEach(clearTimeout); observers.forEach((o) => o.disconnect()); };
}
