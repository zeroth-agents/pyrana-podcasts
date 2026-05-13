/**
 * GitHub host adapter.
 * Commits MP3 episodes and the RSS feed to a GitHub repo so they can be
 * served by GitHub Pages. Replaces the old Drive-based hosting.
 *
 * Required Script Property:  GITHUB_TOKEN
 *   A fine-grained PAT scoped to the host repo with Contents: read+write.
 *
 * Required Config:  CONFIG.GITHUB.{owner,repo,branch,publishDir,pagesBaseUrl}
 */

function publishEpisode(audioBlob, subject, date, scriptTurns, showNotes) {
  const filename = sanitizeFilename(subject) + '.mp3';
  const audioPath = CONFIG.GITHUB.publishDir + '/episodes/' + filename;
  const basename = sanitizeFilename(subject);

  Logger.log('  ⬆️  Committing MP3 to GitHub...');
  const audioCommit = githubPutFile(
    audioPath,
    audioBlob.getBytes(),
    'episode: ' + subject
  );
  Logger.log('  → ' + audioCommit.commit.sha.slice(0, 7));

  Logger.log('  📝 Committing transcript + show notes...');
  publishTranscript(scriptTurns, basename, subject);
  if (showNotes) publishShowNotes(showNotes, basename, subject);

  const audioUrl = CONFIG.GITHUB.pagesBaseUrl + '/episodes/' + encodeURIComponent(filename);
  const audioInfo = {
    name: filename,
    size: audioBlob.getBytes().length,
    url: audioUrl,
    guid: audioPath,        // path is stable, unique, human-readable
    date: date,
    subject: subject,
  };

  Logger.log('  📡 Updating RSS feed...');
  updateRssFeed(audioInfo, scriptTurns, showNotes);

  return audioInfo;
}

/**
 * Commit the parsed script as a plain-text file next to the MP3 so it
 * can be reviewed, diffed in PRs, or fed back into future prompt-tuning.
 * Format: one turn per line, prefixed with HOST_A: / HOST_B:.
 */
function publishTranscript(scriptTurns, basename, subject) {
  const path = CONFIG.GITHUB.publishDir + '/episodes/transcripts/' + basename + '.txt';
  const lines = scriptTurns.map(function (t) {
    return 'HOST_' + t.speaker + ': ' + t.text;
  });
  const text = lines.join('\n') + '\n';
  const bytes = Utilities.newBlob(text).getBytes();
  githubPutFile(path, bytes, 'transcript: ' + subject);
}

/**
 * Commit the HTML show notes used in the RSS <description> so a human
 * (or future prompt-tuning) can review what listeners see in Spotify.
 */
function publishShowNotes(html, basename, subject) {
  const path = CONFIG.GITHUB.publishDir + '/episodes/transcripts/' + basename + '.show-notes.html';
  const bytes = Utilities.newBlob(html).getBytes();
  githubPutFile(path, bytes, 'show notes: ' + subject);
}

function updateRssFeed(audioInfo, scriptTurns, showNotes) {
  const rssPath = CONFIG.GITHUB.publishDir + '/podcast.xml';
  const existingFile = githubGetFile(rssPath);
  const existingXml = existingFile ? existingFile.content : '';
  const existing = parseEpisodes(existingXml);

  if (existing.some(function (e) { return e.guid === audioInfo.guid; })) {
    Logger.log('  (already in feed, skipping)');
    return;
  }

  const description = showNotes && showNotes.length
    ? showNotes
    : scriptTurns.slice(0, 3).map(function (t) { return t.text; }).join(' ').slice(0, 400);

  existing.unshift({
    title: audioInfo.subject,
    pubDate: audioInfo.date,
    audioUrl: audioInfo.url,
    audioSize: audioInfo.size,
    guid: audioInfo.guid,
    description: description,
    durationSec: estimateDuration(scriptTurns),
  });

  const trimmed = existing.slice(0, 50);
  const newXml = buildRssXml(trimmed);

  githubPutFile(
    rssPath,
    Utilities.newBlob(newXml).getBytes(),
    'feed: ' + audioInfo.subject,
    existingFile ? existingFile.sha : null
  );
}

function getFeedUrl() {
  return CONFIG.GITHUB.pagesBaseUrl + '/podcast.xml';
}

// ─── GitHub API primitives ──────────────────────────────────────────

function githubGetFile(path) {
  const url = githubApiUrl(path) + '?ref=' + encodeURIComponent(CONFIG.GITHUB.branch);
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: githubHeaders(),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('GitHub GET ' + path + ' → ' + code + ': ' + resp.getContentText());

  const data = JSON.parse(resp.getContentText());
  // GitHub base64-encodes file contents and wraps lines at 60 chars.
  const content = Utilities.newBlob(Utilities.base64Decode(data.content.replace(/\n/g, ''))).getDataAsString();
  return { sha: data.sha, content: content };
}

/**
 * Create or update a file at `path`. `bytes` is a byte array (e.g.
 * `blob.getBytes()`). Pass `sha` when updating an existing file.
 * If `sha` is null, we'll look it up so callers don't have to.
 */
function githubPutFile(path, bytes, message, sha) {
  if (sha === undefined) sha = null;
  if (sha === null) {
    const existing = githubGetFile(path);
    if (existing) sha = existing.sha;
  }

  const payload = {
    message: message,
    content: Utilities.base64Encode(bytes),
    branch: CONFIG.GITHUB.branch,
    committer: CONFIG.GITHUB.commitAuthor,
    author: CONFIG.GITHUB.commitAuthor,
  };
  if (sha) payload.sha = sha;

  const resp = UrlFetchApp.fetch(githubApiUrl(path), {
    method: 'put',
    contentType: 'application/json',
    headers: githubHeaders(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub PUT ' + path + ' → ' + code + ': ' + resp.getContentText().slice(0, 500));
  }
  return JSON.parse(resp.getContentText());
}

function githubApiUrl(path) {
  return 'https://api.github.com/repos/' +
    encodeURIComponent(CONFIG.GITHUB.owner) + '/' +
    encodeURIComponent(CONFIG.GITHUB.repo) + '/contents/' +
    path.split('/').map(encodeURIComponent).join('/');
}

function githubHeaders() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN not set in Script Properties');
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pyrana-podcast-bot',
  };
}

function sanitizeFilename(s) {
  return s
    .replace(/[^a-zA-Z0-9 \-—]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 100);
}
