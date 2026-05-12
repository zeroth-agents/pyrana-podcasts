/**
 * Source-paper ingestion.
 *
 * Pulls links out of the PYRANA email and fetches content so the
 * script-writing pass can talk about what's actually in the papers,
 * not just what the digest summarized.
 *
 * Two-step:
 *   extractPaperLinks(emailBody) → [{url, kind}]
 *   fetchPaperContent(link)      → {url, title, text}   (or null on failure)
 *
 * Designed to be best-effort: a paper that fails to fetch is logged
 * and skipped, never blocks the episode.
 */

// Keep total source material under this many chars so we don't blow
// past Claude's context or the Apps Script 6-min trigger window.
// 18k chars/paper ≈ 4.5k words ≈ a full paper intro/method/results section.
// 72k total keeps the Sonnet research pass under ~20k input tokens, which
// returns in well under the UrlFetchApp ceiling (60s typical, 5 min hard cap).
const PAPERS_MAX_PER_PAPER_CHARS = 18000;
const PAPERS_MAX_TOTAL_CHARS = 72000;
const PAPERS_MAX_COUNT = 8;
const PAPERS_FETCH_TIMEOUT_MS = 15000;

/**
 * Pull paper-ish links out of an email body. Handles plain URLs and
 * Markdown-style [label](url) links. Dedupes and classifies.
 *
 * Returns: [{ url, kind }]  where kind is 'arxiv' | 'web'
 */
function extractPaperLinks(emailBody) {
  if (!emailBody) return [];

  const found = new Map();  // url → kind

  // Markdown links first so we capture the URL inside parens cleanly.
  const mdRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = mdRe.exec(emailBody)) !== null) {
    addCandidate(found, m[2]);
  }

  // Plain URLs. Strip trailing punctuation that's almost never part of the URL.
  const urlRe = /https?:\/\/[^\s<>"'`)\]]+/g;
  while ((m = urlRe.exec(emailBody)) !== null) {
    let url = m[0].replace(/[.,;:!?)\]]+$/, '');
    addCandidate(found, url);
  }

  const links = [];
  for (const [url, kind] of found.entries()) {
    links.push({ url: url, kind: kind });
  }

  // Prefer arxiv links — they're the highest signal.
  links.sort(function (a, b) {
    if (a.kind === b.kind) return 0;
    return a.kind === 'arxiv' ? -1 : 1;
  });

  return links.slice(0, PAPERS_MAX_COUNT);
}

function addCandidate(found, rawUrl) {
  const norm = normalizePaperUrl(rawUrl);
  if (!norm) return;
  if (found.has(norm.url)) return;

  // Skip noise: tracking pixels, unsubscribe, mailto, image hosts, social.
  if (isNoiseUrl(norm.url)) return;

  found.set(norm.url, norm.kind);
}

function normalizePaperUrl(rawUrl) {
  let url = rawUrl.trim();
  if (!url) return null;

  // arXiv: collapse /pdf/<id> and /abs/<id>(vN) to a canonical /abs/<id>.
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?(?:\.pdf)?/i);
  if (arxivMatch) {
    return { url: 'https://arxiv.org/abs/' + arxivMatch[1], kind: 'arxiv' };
  }

  return { url: url, kind: 'web' };
}

function isNoiseUrl(url) {
  const noisePatterns = [
    /unsubscribe/i,
    /\.(png|jpe?g|gif|svg|webp|ico)(\?|$)/i,
    /mailto:/i,
    /(twitter|x)\.com\//i,
    /linkedin\.com\//i,
    /facebook\.com\//i,
    /youtube\.com\/watch/i,  // video, not paper
    /list-manage\.com/i,
    /click\.[^/]+\//i,
    /utm_/i,                  // generic tracker — not by itself disqualifying but rare for papers
  ];
  // utm_ is overly aggressive — only treat as noise if there's no path of substance.
  for (const pat of noisePatterns) {
    if (pat === noisePatterns[noisePatterns.length - 1]) continue;
    if (pat.test(url)) return true;
  }
  return false;
}

/**
 * Fetch one paper's content. Returns {url, title, text} or null.
 * Caller: don't await this serially across many papers without
 * watching the 6-min trigger budget.
 */
function fetchPaperContent(link) {
  try {
    if (link.kind === 'arxiv') {
      const id = link.url.match(/abs\/([0-9]{4}\.[0-9]{4,5})/)[1];
      // Prefer full HTML body — much richer than the abstract — and
      // fall back to the abstract API if HTML isn't available for this paper.
      const html = fetchArxivHtml(id, link.url);
      if (html) return html;
      return fetchArxivAbstract(id, link.url);
    }
    return fetchGenericPage(link.url);
  } catch (e) {
    Logger.log('    ⚠️  fetch failed for ' + link.url + ': ' + e.message);
    return null;
  }
}

/**
 * Fetch the rendered HTML version of an arXiv paper (full body, not
 * just the abstract). arXiv exposes this at /html/<id> for most papers
 * since 2024; older papers may 404 and fall back to the abstract.
 */
function fetchArxivHtml(id, canonicalUrl) {
  const url = 'https://arxiv.org/html/' + id;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'pyrana-podcast-bot/1.0' },
  });
  if (res.getResponseCode() !== 200) return null;

  const html = res.getContentText();
  // ar5iv-style pages embed a "no HTML available" notice for papers
  // that don't have a rendered version yet. Detect and fall back.
  if (/no HTML available|cannot be rendered/i.test(html)) return null;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeXml(titleMatch[1]).replace(/\s+/g, ' ').replace(/\s*\|\s*arXiv.*$/i, '').trim()
    : id;

  const bodyText = stripHtml(html);
  if (bodyText.length < 2000) return null;  // probably a stub page

  return {
    url: canonicalUrl,
    title: title,
    text: bodyText.slice(0, PAPERS_MAX_PER_PAPER_CHARS),
  };
}

/**
 * arXiv export API gives us clean Atom XML with title + abstract.
 * Way more reliable than scraping the HTML page.
 */
function fetchArxivAbstract(id, canonicalUrl) {
  const url = 'http://export.arxiv.org/api/query?id_list=' + id;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('arxiv ' + res.getResponseCode());
  }
  const xml = res.getContentText();
  const title = (xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const summary = (xml.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || '';
  const authors = [];
  const authorRe = /<author>\s*<name>([^<]+)<\/name>/g;
  let am;
  while ((am = authorRe.exec(xml)) !== null) authors.push(am[1].trim());

  const cleanTitle = decodeXml(title).replace(/\s+/g, ' ').trim();
  const cleanSummary = decodeXml(summary).replace(/\s+/g, ' ').trim();

  let text = '';
  if (authors.length) text += 'Authors: ' + authors.slice(0, 6).join(', ') + '\n\n';
  text += 'Abstract: ' + cleanSummary;

  return {
    url: canonicalUrl,
    title: cleanTitle,
    text: text.slice(0, PAPERS_MAX_PER_PAPER_CHARS),
  };
}

function fetchGenericPage(url) {
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'pyrana-podcast-bot/1.0' },
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('http ' + res.getResponseCode());
  }
  const html = res.getContentText();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeXml(titleMatch[1]).replace(/\s+/g, ' ').trim() : url;

  // Prefer description meta tags, then strip the body.
  const metaDesc =
    (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1] ||
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] ||
    '';

  const bodyText = stripHtml(html);

  let text = '';
  if (metaDesc) text += 'Summary: ' + decodeXml(metaDesc).trim() + '\n\n';
  text += bodyText;

  return {
    url: url,
    title: title,
    text: text.slice(0, PAPERS_MAX_PER_PAPER_CHARS),
  };
}

function stripHtml(html) {
  // Drop scripts/styles/nav/footer first so we don't capture menus.
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeXml(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Fetch a list of links, respecting the global character cap.
 * Returns: [{url, title, text}] in original order, fetch failures dropped.
 */
function fetchAllPapers(links) {
  const out = [];
  let totalChars = 0;

  for (const link of links) {
    if (totalChars >= PAPERS_MAX_TOTAL_CHARS) {
      Logger.log('    ⏸  hit total char cap, skipping remaining ' +
                 (links.length - out.length) + ' link(s)');
      break;
    }
    const paper = fetchPaperContent(link);
    if (!paper || !paper.text) continue;

    // Trim if this paper would push us over the total cap.
    const remaining = PAPERS_MAX_TOTAL_CHARS - totalChars;
    if (paper.text.length > remaining) {
      paper.text = paper.text.slice(0, remaining);
    }

    out.push(paper);
    totalChars += paper.text.length;
  }

  return out;
}
