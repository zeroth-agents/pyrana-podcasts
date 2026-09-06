/**
 * Parallel Search API client — the "deeper compare" stage.
 *
 * For each paper, we ask Parallel for prior and related work on the web so
 * the research pass can ground its "Field connection" and steel-manned
 * objection in real retrieved sources rather than the model's memory.
 *
 * Endpoint:  POST https://api.parallel.ai/v1/search
 * Auth:      x-api-key header (PARALLEL_API_KEY in Script Properties)
 * Request:   { objective, search_queries[], processor, max_results,
 *              max_chars_per_result }
 * Response:  { search_id, results: [{url, title, publish_date,
 *              excerpts[]}], warnings, usage, session_id }
 *
 * Synchronous (one POST per paper), so it fits the 6-minute Apps Script
 * ceiling — the async Task API would not.
 *
 * Everything here degrades gracefully. No key, disabled config, or an API
 * error never throws: the episode still publishes, just without the compare.
 */

/**
 * Run one Parallel search and return its result objects (possibly empty).
 * Throws only on a hard misconfiguration the caller wants to know about
 * (missing key) — HTTP/network errors are surfaced as thrown errors too,
 * so the per-paper caller can catch and skip just that paper.
 */
function parallelSearch(objective, searchQueries) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('PARALLEL_API_KEY');
  if (!apiKey) throw new Error('PARALLEL_API_KEY not set in Script Properties');

  const response = UrlFetchApp.fetch(CONFIG.PARALLEL.endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey },
    // /v1/search only accepts objective + search_queries; it rejects
    // processor / max_results / max_chars_per_result as extra inputs (422).
    // We cap result count and excerpt length client-side instead.
    payload: JSON.stringify({
      objective: objective,
      search_queries: searchQueries,
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Parallel API error ' + response.getResponseCode() + ': ' +
                    response.getContentText().slice(0, 500));
  }

  const data = JSON.parse(response.getContentText());
  return (data.results || []);
}

/**
 * Deeper-compare step. For up to CONFIG.PARALLEL.maxPapersToCompare papers,
 * retrieve prior/related work and return a structured digest the research
 * pass can inject.
 *
 * Returns:
 *   { ran: boolean, items: [{ title, sources: [{title, url, excerpt}] }] }
 *
 * ran is true only if at least one paper actually got retrieved sources —
 * that flag is what the show-notes footer keys off of, so it stays honest.
 */
function deeperCompareForPapers(papers) {
  const empty = { ran: false, items: [] };

  if (!CONFIG.PARALLEL || !CONFIG.PARALLEL.enabled) {
    Logger.log('  🔭 Deeper compare: disabled in config, skipping.');
    return empty;
  }
  if (!PropertiesService.getScriptProperties().getProperty('PARALLEL_API_KEY')) {
    Logger.log('  🔭 Deeper compare: no PARALLEL_API_KEY, skipping.');
    return empty;
  }
  if (!papers || !papers.length) {
    Logger.log('  🔭 Deeper compare: no papers to compare, skipping.');
    return empty;
  }

  const cap = CONFIG.PARALLEL.maxPapersToCompare;
  const targets = papers.slice(0, cap);
  Logger.log('  🔭 Deeper compare: searching prior work for ' + targets.length +
             ' paper(s) via Parallel...');

  const items = [];
  for (let i = 0; i < targets.length; i++) {
    const title = targets[i].title;
    const objective =
      'Find prior and related work for the AI research paper titled "' + title + '". ' +
      'Surface earlier approaches, competing methods, and benchmark comparisons so ' +
      'we can assess its novelty and the strongest critiques of its claims.';
    const queries = [title, title + ' prior work comparison benchmark'];

    try {
      const results = parallelSearch(objective, queries)
        .slice(0, CONFIG.PARALLEL.maxResultsPerPaper);
      const sources = results.map(function (r) {
        return {
          title: r.title || r.url,
          url: r.url,
          excerpt: (r.excerpts && r.excerpts.length ? r.excerpts.join(' ') : '')
            .slice(0, CONFIG.PARALLEL.maxCharsPerResult),
        };
      }).filter(function (s) { return s.url && s.excerpt; });

      if (sources.length) {
        items.push({ title: title, sources: sources });
        Logger.log('     • [' + (i + 1) + '] ' + sources.length + ' source(s)');
      } else {
        Logger.log('     • [' + (i + 1) + '] no usable results');
      }
    } catch (e) {
      // One paper failing must not sink the batch or the episode.
      Logger.log('     • [' + (i + 1) + '] Parallel search failed: ' + e.message);
    }
  }

  return { ran: items.length > 0, items: items };
}

/**
 * Render the compare digest as a text block for the research-pass prompt.
 * Returns '' when nothing was retrieved, so callers can concatenate freely.
 */
function formatCompareForPrompt(compare) {
  if (!compare || !compare.ran || !compare.items.length) return '';

  let block =
    '─── Prior & related work (retrieved live via Parallel web search) ───\n' +
    'Use this to ground the "Field connection" and "Steel-manned objection" ' +
    'lines in real prior work — name specific competing methods or benchmarks ' +
    'where useful. These are EXTERNAL context, not the paper itself; do not ' +
    'attribute their claims to the paper.\n\n';

  for (let i = 0; i < compare.items.length; i++) {
    const it = compare.items[i];
    block += '[' + (i + 1) + '] ' + it.title + '\n';
    for (let j = 0; j < it.sources.length; j++) {
      const s = it.sources[j];
      block += '  • ' + s.title + ' — ' + s.excerpt + ' (' + s.url + ')\n';
    }
    block += '\n';
  }
  return block;
}
