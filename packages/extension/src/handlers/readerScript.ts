/**
 * Page-side reader extraction (heuristic, readability-style), run via
 * Runtime.evaluate (returnByValue). Picks the best content root — article →
 * main/[role=main] → the densest <p> container → body — and returns its
 * innerText (whitespace-normalized, capped) plus title/byline/excerpt/lang, or
 * null when there's nothing readable. Page-side string — not unit-tested
 * directly (precedent: collectorScript/markScript); reader.ts's coercion is.
 */
export const READER_JS = `(() => {
  try {
    var MAX = 100000;
    var attr = function (sel, a) { var el = document.querySelector(sel); return el ? (el.getAttribute(a) || '').trim() : ''; };
    var ptext = function (el) { var n = 0; var ps = el.querySelectorAll('p'); for (var i = 0; i < ps.length; i++) n += (ps[i].innerText || '').length; return n; };
    var root = document.querySelector('article') || document.querySelector('main, [role=main]');
    if (!root) {
      var best = null, bestLen = 0, els = document.querySelectorAll('div, section');
      for (var i = 0; i < els.length; i++) { var l = ptext(els[i]); if (l > bestLen) { bestLen = l; best = els[i]; } }
      root = bestLen > 0 ? best : document.body;
    }
    if (!root) return null;
    var lines = (root.innerText || '').split('\\n');
    var kept = [];
    for (var j = 0; j < lines.length; j++) { var t = lines[j].trim(); if (t) kept.push(t); }
    var textContent = kept.join('\\n').slice(0, MAX);
    if (!textContent) return null;
    var h1 = document.querySelector('h1');
    var title = attr('meta[property="og:title"]', 'content') || (document.title || '').trim() || (h1 ? (h1.innerText || '').trim() : '');
    var au = document.querySelector('[rel=author]');
    var byline = attr('meta[name="author"]', 'content') || attr('meta[property="article:author"]', 'content') || (au ? (au.innerText || '').trim() : '');
    var excerpt = attr('meta[name="description"]', 'content') || attr('meta[property="og:description"]', 'content') || textContent.slice(0, 200);
    var lang = (document.documentElement.getAttribute('lang') || '').trim();
    return { title: title, byline: byline || null, excerpt: excerpt || null, textContent: textContent, length: textContent.length, lang: lang || null };
  } catch (e) { return null; }
})()`;
