/**
 * Page-side collector: one DOM pass gathering everything the analyzers need
 * (interactive elements, role counts, search inputs, forms, nav, hrefs, query
 * params, and authoritative [data-agent-action] elements). Returns a `Collected`
 * object via `Runtime.evaluate` (returnByValue). Page-side string — not unit-
 * tested directly (precedent: markScript.ts); the orchestrator test feeds its
 * result through fakeCdp.
 */
export const COLLECTOR_JS = `(() => {
  const text = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 80);
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[contenteditable],[tabindex]';
  const interactive = []; const elementsByRole = {}; const searchInputs = [];
  for (const el of document.querySelectorAll(SEL)) {
    const role = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const label = text(el);
    interactive.push({ tag, role, label, href: el.getAttribute('href') });
    const roleKey = role || tag;
    elementsByRole[roleKey] = (elementsByRole[roleKey] || 0) + 1;
    const t = (el.getAttribute('type') || '').toLowerCase();
    if (role === 'searchbox' || t === 'search' || /search/i.test(label)) searchInputs.push({ label });
  }
  const forms = [];
  for (const f of document.querySelectorAll('form')) {
    const fields = [];
    for (const inp of f.querySelectorAll('input,select,textarea')) {
      fields.push({ name: inp.getAttribute('name') || '', type: (inp.getAttribute('type') || inp.tagName.toLowerCase()).toLowerCase() });
    }
    const submit = f.querySelector('[type=submit],button');
    forms.push({ action: f.getAttribute('action') || '', method: (f.getAttribute('method') || 'get').toLowerCase(), fields, submitLabel: submit ? text(submit) : null });
  }
  const nav = [];
  for (const n of document.querySelectorAll('nav')) {
    const links = [];
    for (const a of n.querySelectorAll('a[href]')) links.push({ label: text(a), href: a.getAttribute('href') || '' });
    nav.push({ label: n.getAttribute('aria-label'), links });
  }
  const hrefs = Array.from(document.querySelectorAll('a[href]'), (a) => a.href);
  const declaredActions = Array.from(document.querySelectorAll('[data-agent-action]'), (el) => ({ name: el.getAttribute('data-agent-action') || '', tag: el.tagName.toLowerCase(), label: text(el) }));
  const queryParams = Array.from(new URLSearchParams(location.search).keys());
  return { origin: location.origin, url: location.href, elementsByRole, interactive, searchInputs, forms, nav, hrefs, queryParams, declaredActions };
})()`;
