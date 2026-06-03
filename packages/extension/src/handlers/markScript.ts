/**
 * Page-side scripts for `screenshotMarked`, ported from the Horizon POC.
 *
 * MARK_INJECT_JS finds the visible interactive elements, overlays a numbered
 * badge on each in a single mounted `<div id="__horizon_marks">`, and returns
 * each mark's center + descriptor. The agent then clicks "mark N" by its (x, y)
 * instead of pixel-hunting — the set-of-marks pattern. `"__ORDER__"` is replaced
 * with the JSON-encoded order ("reading" reranks badges top-to-bottom,
 * left-to-right; anything else keeps DOM order). MARK_REMOVE_JS tears the
 * overlay back out in one line, leaving no DOM residue.
 *
 * These run in the page (via CDP Runtime.evaluate), never in the extension, so
 * they're opaque string data here — the handler orchestration around them is
 * what carries the logic under test.
 */
export const MARK_INJECT_JS = `(() => {
  const ORDER = "__ORDER__";
  const PREV = document.getElementById('__horizon_marks');
  if (PREV) PREV.remove();
  const cap = 80;
  const sel = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]',
    '[role=checkbox]', '[role=radio]', '[role=switch]',
    '[contenteditable=""]', '[contenteditable=true]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const vw = window.innerWidth, vh = window.innerHeight;
  const seen = new Set();
  const cand = [];
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const label = (el.getAttribute('aria-label') ||
                   el.getAttribute('title') ||
                   el.getAttribute('placeholder') ||
                   el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    cand.push({
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      label,
      href: el.getAttribute('href'),
      _rect: { l: r.left, t: r.top, w: r.width, h: r.height },
    });
  }
  if (ORDER === 'reading') {
    const heights = cand.map(c => c.h).sort((a, b) => a - b);
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 24;
    const rowTol = Math.max(8, Math.min(medianH * 0.6, 40));
    const byY = cand.slice().sort((a, b) => a._rect.t - b._rect.t);
    const rows = [];
    for (const c of byY) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(c._rect.t - last[0]._rect.t) <= rowTol) last.push(c);
      else rows.push([c]);
    }
    for (const row of rows) row.sort((a, b) => a._rect.l - b._rect.l);
    cand.length = 0;
    for (const row of rows) for (const c of row) cand.push(c);
  }
  const marks = cand.slice(0, cap).map((c, i) => ({ id: i + 1, ...c }));
  const overlay = document.createElement('div');
  overlay.id = '__horizon_marks';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const colors = ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6'];
  for (const m of marks) {
    const r = m._rect;
    const box = document.createElement('div');
    const c = colors[(m.id - 1) % colors.length];
    box.style.cssText = 'position:absolute;left:'+r.l+'px;top:'+r.t+'px;width:'+r.w+'px;height:'+r.h+'px;border:2px solid '+c+';box-sizing:border-box';
    const tag = document.createElement('div');
    tag.textContent = String(m.id);
    tag.style.cssText = 'position:absolute;left:-2px;top:-18px;background:'+c+';color:#fff;font:bold 12px/16px sans-serif;padding:0 4px;min-width:14px;text-align:center;border-radius:2px';
    box.appendChild(tag);
    overlay.appendChild(box);
    delete m._rect;
  }
  document.documentElement.appendChild(overlay);
  return marks;
})()`;

export const MARK_REMOVE_JS = `(() => { const o = document.getElementById('__horizon_marks'); if (o) o.remove(); })()`;
