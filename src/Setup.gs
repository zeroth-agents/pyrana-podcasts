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
  const google = props.getProperty('GOOGLE_API_KEY');
  if (!claude) throw new Error('ANTHROPIC_API_KEY not set');
  if (!google) throw new Error('GOOGLE_API_KEY not set');

  Logger.log('Testing Claude...');
  const claudeResp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': claude, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: CONFIG.CLAUDE.researchModel,
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "hello podcast" and nothing else.' }],
    }),
    muteHttpExceptions: true,
  });
  if (claudeResp.getResponseCode() !== 200) {
    throw new Error('Claude failed: ' + claudeResp.getContentText());
  }
  Logger.log('  ✓ Claude OK');

  Logger.log('Testing Gemini multi-speaker TTS (short clip)...');
  const testTurns = [
    { speaker: 'A', text: 'Quick test of the audio pipeline.' },
    { speaker: 'B', text: 'Sounds good. We are live.' },
  ];
  const pcm = synthesizeEpisode(testTurns);
  const totalBytes = pcm.pcmChunks.reduce(function (n, c) { return n + c.length; }, 0);
  if (totalBytes < 1000) {
    throw new Error('Gemini TTS returned suspiciously small payload: ' + totalBytes + ' bytes');
  }
  Logger.log('  ✓ Gemini TTS OK (' + totalBytes + ' bytes PCM)');

  Logger.log('Testing MP3 encoder (lamejs)...');
  const mp3 = encodePcmToMp3(pcm);
  const mp3Bytes = mp3.getBytes().length;
  if (mp3Bytes < 500) {
    throw new Error('MP3 encoder returned suspiciously small file: ' + mp3Bytes + ' bytes');
  }
  Logger.log('  ✓ lamejs OK (' + mp3Bytes + ' bytes MP3)');

  Logger.log('');
  Logger.log('✅ All APIs working. Run setup_3_firstEpisode() to generate a real episode.');
}

/**
 * STEP 2b — Optional: render and Drive-save a one-minute Gemini test clip
 * so you can listen to the voices before committing to a full episode.
 */
function setup_2b_testGemini() {
  const turns = [
    { speaker: 'A', text: 'Welcome to the test. We\'re trying out the new voices today.' },
    { speaker: 'B', text: 'Yeah, this is Gemini multi-speaker. Tell me how it sounds.' },
    { speaker: 'A', text: 'I think it has a more natural cadence than the old setup.' },
    { speaker: 'B', text: 'Right — and it handles interjections without the awkward gap.' },
  ];
  const pcm = synthesizeEpisode(turns);
  const mp3 = encodePcmToMp3(pcm);
  const file = DriveApp.createFile(mp3.setName('pyrana-tts-test.mp3'));
  Logger.log('✅ Test clip saved to Drive: ' + file.getUrl());
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

/**
 * Utility — write a secret into Script Properties from inside Apps Script,
 * no GUI click-through. Use for first-time setup or key rotation.
 *
 * Workflow:
 *   1. Paste the key into the literal below
 *   2. Run this function once from the editor
 *   3. Blank the literal back to '' and save BEFORE you `clasp push`
 *      so the key never lands in git
 *
 * Anything left blank is left untouched — paste only the keys you want
 * to set on this run.
 */
function utility_setSecrets() {
  const secrets = {
    ANTHROPIC_API_KEY: '',
    GOOGLE_API_KEY: '',
    GITHUB_TOKEN: '',
  };

  const props = PropertiesService.getScriptProperties();
  let wrote = 0;
  for (const k in secrets) {
    if (secrets[k]) {
      props.setProperty(k, secrets[k]);
      Logger.log('  ✓ wrote ' + k + ' (' + secrets[k].length + ' chars)');
      wrote++;
    }
  }
  if (wrote === 0) {
    throw new Error('No secrets pasted. Edit utility_setSecrets() and paste the key(s) you want to set.');
  }
  Logger.log('✅ ' + wrote + ' secret(s) written. Blank the literals and save before pushing.');
}
