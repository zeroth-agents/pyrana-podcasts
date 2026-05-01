/**
 * PYRANA → Spotify Podcast Bot
 * ─────────────────────────────
 * Triggered hourly (or manually). For each new PYRANA email since the
 * last successful run, this script:
 *
 *   1. Fetches the email body from Gmail
 *   2. Asks Claude to turn it into a 2-host podcast script
 *   3. Synthesizes audio via ElevenLabs (one voice per host)
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

  Logger.log('  ✏️  Writing script...');
  const scriptTurns = generatePodcastScript(subject, body);
  Logger.log('  → ' + scriptTurns.length + ' dialogue turns, ' +
             scriptTurns.reduce(function (n, t) { return n + t.text.length; }, 0) + ' chars');

  Logger.log('  🎙️  Synthesizing audio...');
  const audioBlob = generateAudio(scriptTurns);
  Logger.log('  → ' + Math.round(audioBlob.getBytes().length / 1024) + ' KB');

  publishEpisode(audioBlob, subject, date, scriptTurns);

  Logger.log('  ✅ Published: ' + subject);
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
 * Manual test — generates and prints a script without calling ElevenLabs.
 * Use this to iterate on the prompt without burning TTS credits.
 */
function testScriptOnly() {
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY, 0, 1);
  if (threads.length === 0) throw new Error('No PYRANA emails found');
  const msg = threads[0].getMessages()[0];
  const turns = generatePodcastScript(msg.getSubject(), msg.getPlainBody());
  for (const t of turns) Logger.log('[' + t.speaker + '] ' + t.text);
}
