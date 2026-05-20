/**
 * Parallel.ai Search API client.
 *
 * Used during the research pass to pull EXTERNAL context for each paper —
 * related/competing work, benchmarks, and the wider trend — so the hosts can
 * give a best-of-breed comparison instead of only relating papers back to
 * PYRANA/Cortex.
 *
 * Synchronous Search API, one call per paper. Degrades gracefully: if the
 * PARALLEL_API_KEY is missing, CONFIG.PARALLEL.enabled is false, or a call
 * fails, the helpers return empty and the research pass proceeds without
 * external context — never breaks an episode over this.
 *
 * Set PARALLEL_API_KEY in Script Properties. Never hard-code it here.
 */

function parallelEnabled() {
  if (!CONFIG.PARALLEL || !CONFIG.PARALLEL.enabled) return false;
  return !!PropertiesService.getScriptProperties().getProperty('PARALLEL_API_KEY');
}

/**
 * Run one Search API query. Returns an array of
 *   { url, title, publishDate, excerpts: [String] }
 * or null if disabled / failed.
 */
function parallelSearch(objective, queries) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('PARALLEL_API_KEY');
  if (!apiKey) return null;

  const cfg = CONFIG.PARALLEL;
  const payload = {
    objective: objective,
    search_queries: queries || [],
    max_results: cfg.maxResults,
    max_chars_per_result: cfg.maxCharsPerResult,
  };

  let response;
  try {
    response = UrlFetchApp.fetch(cfg.searchUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('    ⚠️  Parallel search threw: ' + e);
    return null;
  }

  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('    ⚠️  Parallel search ' + code + ': ' +
               response.getContentText().slice(0, 300));
    return null;
  }

  let data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('    ⚠️  Parallel search: unparseable response');
    return null;
  }

  return (data.results || []).map(function (r) {
    return {
      url: r.url || '',
      title: r.title || '',
      publishDate: r.publish_date || '',
      excerpts: r.excerpts || [],
    };
  });
}

/**
 * Build an external-comparison context block for one paper, ready to drop
 * into the research-pass prompt. Returns '' if disabled or nothing found.
 */
function parallelComparisonForPaper(paper) {
  const title = (paper && paper.title) ? paper.title : '';
  if (!title) return '';

  const objective =
    'Find recent related work, competing or alternative methods, benchmarks, ' +
    'and expert commentary on the following paper or its topic: "' + title +
    '". Identify which approaches are considered best-of-breed and what the ' +
    'broader trend in this area is.';
  const queries = [title, title + ' comparison benchmark', title + ' related work'];

  const results = parallelSearch(objective, queries);
  if (!results || !results.length) return '';

  const budget = CONFIG.PARALLEL.maxCharsPerResult;
  let block = 'External context for "' + title + '" (via Parallel web search — ' +
              'use it for the "Field connection" and "Comparative / best-of-breed" ' +
              'lines; cite sources by name, never paste URLs):\n';
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const excerpt = (r.excerpts || []).join(' ').slice(0, budget);
    block += '  • ' + (r.title || r.url);
    if (r.publishDate) block += ' (' + r.publishDate + ')';
    block += ': ' + excerpt + '\n';
  }
  return block + '\n';
}

/**
 * Gather external comparison context for a batch of fetched papers, capped
 * at CONFIG.PARALLEL.maxPapers calls to bound latency against the 6-minute
 * Apps Script execution limit. Returns a single concatenated string ('' if
 * disabled or nothing found).
 */
function gatherParallelContext(papers) {
  if (!parallelEnabled() || !papers || !papers.length) return '';

  const cap = Math.min(papers.length, CONFIG.PARALLEL.maxPapers);
  Logger.log('  🌐 Parallel: gathering external context for ' + cap + ' paper(s)...');

  let out = '';
  for (let i = 0; i < cap; i++) {
    const block = parallelComparisonForPaper(papers[i]);
    if (block) out += block;
    Utilities.sleep(300); // polite gap between calls
  }
  return out;
}
