/**
 * PYRANA → Spotify Podcast Bot
 * ─────────────────────────────
 * Triggered hourly (or manually). For each new PYRANA email since the
 * last successful run, this script:
 *
 *   1. Fetches the email body from Gmail
 *   2. Asks Claude to turn it into a 2-host podcast script
 *   3. Synthesizes audio via Gemini multi-speaker TTS, encodes to MP3
 *   4. Commits the MP3 to the host GitHub repo (Pages-served)
 *   5. Updates the RSS feed in the same repo
 *
 * Spotify polls the RSS feed every few hours and ingests new episodes.
 */

function processNewPyranaEmails() {
  const props = PropertiesService.getScriptProperties();
  const lastTs = parseInt(props.getProperty('LAST_PROCESSED_TIMESTAMP') || '0');

  const query = CONFIG.GMAIL_QUERY + ' newer_than:7d';
  const threads = GmailApp.search(query, 0, 10);

  const newMessages = [];
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      if (msg.getDate().getTime() > lastTs) newMessages.push(msg);
    }
  }
  newMessages.sort(function (a, b) { return a.getDate() - b.getDate(); });

  if (newMessages.length === 0) {
    Logger.log('No new PYRANA emails since last run.');
    return;
  }

  Logger.log('Found ' + newMessages.length + ' new email(s).');

  for (const msg of newMessages) {
    try {
      processSingleEmail(msg);
      props.setProperty('LAST_PROCESSED_TIMESTAMP', String(msg.getDate().getTime()));
    } catch (e) {
      Logger.log('❌ Failed: ' + msg.getSubject() + ' — ' + e.message);
      Logger.log(e.stack);
      break;
    }
  }
}

function processSingleEmail(msg) {
  const subject = msg.getSubject();
  const body = msg.getPlainBody();
  const date = msg.getDate();

  Logger.log('📨 ' + subject);

  Logger.log('  🔗 Extracting paper links...');
  const links = extractPaperLinks(body);
  Logger.log('  → ' + links.length + ' candidate link(s)');

  Logger.log('  📥 Fetching paper sources...');
  const papers = fetchAllPapers(links);
  Logger.log('  → ' + papers.length + ' paper(s) fetched, ' +
             papers.reduce(function (n, p) { return n + p.text.length; }, 0) + ' chars');

  const result = generatePodcastScript(subject, body, papers);
  const scriptTurns = result.turns;
  Logger.log('  → ' + scriptTurns.length + ' dialogue turns, ' +
             scriptTurns.reduce(function (n, t) { return n + t.text.length; }, 0) + ' chars');

  Logger.log('  🎙️  Synthesizing audio (Gemini multi-speaker)...');
  const pcm = synthesizeEpisode(scriptTurns);
  Logger.log('  🎚️  Encoding MP3...');
  const audioBlob = encodePcmToMp3(pcm);
  Logger.log('  → ' + Math.round(audioBlob.getBytes().length / 1024) + ' KB');

  publishEpisode(audioBlob, subject, date, scriptTurns);

  Logger.log('  ✅ Published: ' + subject);
}

/**
 * Re-publish previously published episodes using the current pipeline
 * (e.g. after the length/depth prompt was bumped to 15 min).
 *
 * Spotify dedupes on GUID — and our GUID is the file path. So we
 * publish the regenerated audio at "<file>_v2.mp3" rather than
 * overwriting, then drop the old entry from the feed. Spotify sees the
 * v2 as a fresh episode and re-ingests.
 *
 * Idempotent: an episode with a v2 sibling on the repo is skipped. If
 * the 6-min Apps Script ceiling is approaching, the function exits
 * cleanly — just run it again to continue.
 */
function republishOldEpisodes() {
  const startMs = Date.now();
  // Stop starting new episodes after ~4 min so the current one finishes.
  const SOFT_DEADLINE_MS = 4 * 60 * 1000;

  const threads = GmailApp.search(CONFIG.GMAIL_QUERY + ' newer_than:60d', 0, 30);
  const msgs = [];
  for (const t of threads) for (const m of t.getMessages()) msgs.push(m);
  msgs.sort(function (a, b) { return a.getDate() - b.getDate(); });  // oldest first

  let republished = 0;
  let skipped = 0;
  let pending = 0;

  for (const msg of msgs) {
    const subject = msg.getSubject();
    const base = sanitizeFilename(subject);
    const v2Path = CONFIG.GITHUB.publishDir + '/episodes/' + base + '_v2.mp3';
    const oldPath = CONFIG.GITHUB.publishDir + '/episodes/' + base + '.mp3';

    // Skip if v2 already exists.
    if (githubGetFile(v2Path)) {
      skipped++;
      continue;
    }

    // Skip if we never published the original in the first place
    // (e.g. an email the bot failed on — no point republishing nothing).
    if (!githubGetFile(oldPath)) {
      continue;
    }

    if (Date.now() - startMs > SOFT_DEADLINE_MS) {
      pending++;
      continue;
    }

    Logger.log('🔁 Republishing: ' + subject);
    try {
      republishSingleEmail(msg, base + '_v2.mp3', base + '.mp3');
      republished++;
    } catch (e) {
      Logger.log('❌ Failed: ' + subject + ' — ' + e.message);
      Logger.log(e.stack);
      break;
    }
  }

  Logger.log('');
  Logger.log('── Republish summary ──');
  Logger.log('  republished this run: ' + republished);
  Logger.log('  already v2 (skipped): ' + skipped);
  Logger.log('  pending (re-run me):  ' + pending);
}

/**
 * Pipeline copy that publishes to a specific v2 filename and removes
 * the legacy entry from the feed. Used only by republishOldEpisodes.
 */
function republishSingleEmail(msg, newFilename, oldFilename) {
  const subject = msg.getSubject();
  const body = msg.getPlainBody();
  const date = msg.getDate();

  const links = extractPaperLinks(body);
  const papers = fetchAllPapers(links);

  const result = generatePodcastScript(subject, body, papers);
  const scriptTurns = result.turns;

  const pcm = synthesizeEpisode(scriptTurns);
  const audioBlob = encodePcmToMp3(pcm);

  const audioPath = CONFIG.GITHUB.publishDir + '/episodes/' + newFilename;
  Logger.log('  ⬆️  Committing v2 MP3...');
  githubPutFile(audioPath, audioBlob.getBytes(), 'episode: ' + subject + ' (v2)');

  const audioInfo = {
    name: newFilename,
    size: audioBlob.getBytes().length,
    url: CONFIG.GITHUB.pagesBaseUrl + '/episodes/' + encodeURIComponent(newFilename),
    guid: audioPath,
    date: date,
    subject: subject,
  };

  Logger.log('  📡 Replacing feed entry (drop old, add v2)...');
  replaceFeedEntry(audioInfo, scriptTurns, oldFilename);

  Logger.log('  ✅ Republished: ' + subject);
}

/**
 * Like updateRssFeed but also removes any existing entry whose GUID
 * matches the legacy oldFilename, so the v1 episode is gone from the
 * feed entirely.
 */
function replaceFeedEntry(audioInfo, scriptTurns, oldFilename) {
  const rssPath = CONFIG.GITHUB.publishDir + '/podcast.xml';
  const existingFile = githubGetFile(rssPath);
  const existingXml = existingFile ? existingFile.content : '';
  const existing = parseEpisodes(existingXml);

  const oldGuid = CONFIG.GITHUB.publishDir + '/episodes/' + oldFilename;
  const cleaned = existing.filter(function (e) {
    return e.guid !== oldGuid && e.guid !== audioInfo.guid;
  });

  const previewText = scriptTurns
    .slice(0, 3)
    .map(function (t) { return t.text; })
    .join(' ')
    .slice(0, 400);

  cleaned.unshift({
    title: audioInfo.subject,
    pubDate: audioInfo.date,
    audioUrl: audioInfo.url,
    audioSize: audioInfo.size,
    guid: audioInfo.guid,
    description: previewText,
    durationSec: estimateDuration(scriptTurns),
  });

  const trimmed = cleaned.slice(0, 50);
  const newXml = buildRssXml(trimmed);

  githubPutFile(
    rssPath,
    Utilities.newBlob(newXml).getBytes(),
    'feed: ' + audioInfo.subject + ' (v2)',
    existingFile ? existingFile.sha : null
  );
}

/**
 * Manual test — runs the full pipeline on the most recent PYRANA email
 * regardless of whether it's been processed. Useful for first-time setup.
 */
function testWithLatestEmail() {
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY, 0, 1);
  if (threads.length === 0) throw new Error('No PYRANA emails found');
  processSingleEmail(threads[0].getMessages()[0]);
}

/**
 * Manual test — generates and prints a script without calling Gemini TTS.
 * Use this to iterate on the prompt without spending TTS credits.
 */
function testScriptOnly() {
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY, 0, 1);
  if (threads.length === 0) throw new Error('No PYRANA emails found');
  const msg = threads[0].getMessages()[0];

  const links = extractPaperLinks(msg.getPlainBody());
  Logger.log('🔗 ' + links.length + ' candidate link(s):');
  for (const l of links) Logger.log('   [' + l.kind + '] ' + l.url);

  const papers = fetchAllPapers(links);
  Logger.log('📥 ' + papers.length + ' paper(s) fetched');
  for (const p of papers) Logger.log('   • ' + p.title + ' (' + p.text.length + ' chars)');

  const result = generatePodcastScript(msg.getSubject(), msg.getPlainBody(), papers);

  Logger.log('\n── RESEARCH NOTES ──\n' + result.notes);
  Logger.log('\n── SCRIPT ──');
  for (const t of result.turns) Logger.log('[' + t.speaker + '] ' + t.text);
}
