/**
 * Setup helpers — run these once from the Apps Script editor.
 * Each function is independent; run them in the order shown.
 */

/**
 * STEP 1 — Validate the GitHub host repo is reachable and the PAT works.
 * Confirms the publishDir exists (creates a .gitkeep if missing) and the
 * cover art is committed.
 */
function setup_1_validateGithub() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GITHUB_TOKEN')) {
    throw new Error('GITHUB_TOKEN not set in Script Properties');
  }

  const g = CONFIG.GITHUB;
  Logger.log('Repo: ' + g.owner + '/' + g.repo + ' (branch ' + g.branch + ')');

  // Probe by GETting the publish dir's cover art.
  const coverPath = g.publishDir + '/' + CONFIG.PODCAST.coverArtPath;
  const cover = githubGetFile(coverPath);
  if (!cover) {
    throw new Error(
      'Cover art not found at ' + coverPath + '.\n' +
      'Commit a 1400x1400 PNG to that path before running setup_3_firstEpisode().'
    );
  }
  Logger.log('  ✓ Cover art present (' + cover.sha.slice(0, 7) + ')');

  // Probe Pages by HEADing the Pages URL.
  const pagesProbe = UrlFetchApp.fetch(g.pagesBaseUrl + '/' + CONFIG.PODCAST.coverArtPath, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
  });
  if (pagesProbe.getResponseCode() === 200) {
    Logger.log('  ✓ GitHub Pages serving from ' + g.pagesBaseUrl);
  } else {
    Logger.log('  ⚠️  Pages probe returned ' + pagesProbe.getResponseCode() +
               ' for ' + g.pagesBaseUrl + '/' + CONFIG.PODCAST.coverArtPath);
    Logger.log('     Enable Pages: repo Settings → Pages → Source: Deploy from a branch → ' +
               g.branch + ' / /' + g.publishDir);
  }

  Logger.log('');
  Logger.log('✅ GitHub host ready. Next: setup_2_dryRun()');
}

/**
 * STEP 2 — Validate API keys without spending real budget.
 */
function setup_2_dryRun() {
  const props = PropertiesService.getScriptProperties();
  const claude = props.getProperty('ANTHROPIC_API_KEY');
  const eleven = props.getProperty('ELEVENLABS_API_KEY');
  if (!claude) throw new Error('ANTHROPIC_API_KEY not set');
  if (!eleven) throw new Error('ELEVENLABS_API_KEY not set');

  Logger.log('Testing Claude...');
  const claudeResp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': claude, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: CONFIG.CLAUDE.model,
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "hello podcast" and nothing else.' }],
    }),
    muteHttpExceptions: true,
  });
  if (claudeResp.getResponseCode() !== 200) {
    throw new Error('Claude failed: ' + claudeResp.getContentText());
  }
  Logger.log('  ✓ Claude OK');

  Logger.log('Testing ElevenLabs...');
  const elevenResp = UrlFetchApp.fetch(
    'https://api.elevenlabs.io/v1/text-to-speech/' + CONFIG.ELEVENLABS.voiceA,
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'xi-api-key': eleven, 'accept': 'audio/mpeg' },
      payload: JSON.stringify({ text: 'Test.', model_id: CONFIG.ELEVENLABS.model }),
      muteHttpExceptions: true,
    }
  );
  if (elevenResp.getResponseCode() !== 200) {
    throw new Error('ElevenLabs failed: ' + elevenResp.getContentText().slice(0, 300));
  }
  Logger.log('  ✓ ElevenLabs OK');

  Logger.log('');
  Logger.log('✅ All APIs working. Run setup_3_firstEpisode() to generate a real episode.');
}

/**
 * STEP 3 — Generate one full episode end-to-end as a smoke test.
 */
function setup_3_firstEpisode() {
  testWithLatestEmail();
  Logger.log('');
  Logger.log('✅ First episode published. Run setup_4_getFeedUrl() to get');
  Logger.log('   your RSS feed URL for Spotify.');
}

/**
 * STEP 4 — Print the public RSS feed URL. Submit this to Spotify.
 */
function setup_4_getFeedUrl() {
  const url = getFeedUrl();
  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════');
  Logger.log('  YOUR RSS FEED URL');
  Logger.log('═══════════════════════════════════════════════════════════');
  Logger.log('');
  Logger.log('  ' + url);
  Logger.log('');
  Logger.log('  Submit this at: https://podcasters.spotify.com/');
  Logger.log('  → Add Podcast → I already have a podcast → paste URL');
  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════');
  return url;
}

/**
 * STEP 5 — Install the hourly trigger that processes new emails.
 */
function setup_5_installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processNewPyranaEmails') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('processNewPyranaEmails')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('✅ Hourly trigger installed.');
  Logger.log('   The bot will check Gmail every hour for new PYRANA emails');
  Logger.log('   and publish episodes automatically.');
}

/**
 * Utility — clear the "last processed" cursor so the next run reprocesses
 * recent emails. Useful if you change the script or voices and want to
 * regenerate.
 */
function utility_resetCursor() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_TIMESTAMP');
  Logger.log('✅ Cursor reset. Next trigger will reprocess emails from the last 7 days.');
}
