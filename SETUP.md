# PYRANA → Spotify Podcast Bot — Setup Guide

End-to-end automation. Once deployed, every PYRANA Research Intelligence
email becomes a Spotify episode within ~2 hours, with zero clicks.

---

## What you're deploying

```
PYRANA email arrives
    ↓
Apps Script trigger (hourly)
    ↓
Claude writes a 2-host podcast script
    ↓
ElevenLabs synthesizes the audio
    ↓
Apps Script commits MP3 + RSS feed to this GitHub repo
    ↓
GitHub Pages serves them at a stable public URL
    ↓
Spotify polls the RSS, pulls the new episode
    ↓
Episode playable in Spotify (and Apple Podcasts, Overcast, etc.)
```

---

## Cost reality (read before starting)

| Service | What you pay | Notes |
|---|---|---|
| Anthropic API | ~$0.10–0.30/episode | Negligible at this volume |
| ElevenLabs Creator ($22/mo) | 100k chars/mo | Covers ~15–20 episodes/mo |
| ElevenLabs Pro ($99/mo) | 500k chars/mo | Needed for daily episodes |
| Google Apps Script | Free | Generous free quota |
| GitHub Pages | Free | 100 GB/mo bandwidth, plenty |
| Spotify for Podcasters | Free | RSS ingestion is free |

**Daily PYRANA emails × ~5-min episodes ≈ 150k chars/month → you'll need Pro tier ($99/mo) for full daily coverage**, or run weekday-only with shorter episodes.

If $99/mo is steep, swap ElevenLabs for OpenAI TTS or Google Cloud TTS — `src/ElevenLabs.gs` is small and modular.

---

## One-time setup (~30 min)

### 1. Get the API keys

**Anthropic** — pull from Azure Key Vault:
```bash
az keyvault secret show --vault-name pyrana-demo --name demos-anthropic-api-key --query value -o tsv
```

**ElevenLabs** — same pattern:
```bash
az keyvault secret show --vault-name pyrana-demo --name demos-eleven-labs-api-key --query value -o tsv
```

If you don't have these in KV yet, create them at https://console.anthropic.com/ and https://elevenlabs.io/ and store them.

### 2. Push this repo to GitHub

```bash
gh repo create zeroth-agents/pyrana-podcasts --public --source . --push
```

The repo must be **public** — Spotify can't authenticate against GitHub
to fetch a private feed, and GitHub Pages on private repos requires auth.
The repo holds no secrets (those live only in Apps Script Properties).

If you change the name or owner, update `CONFIG.GITHUB.owner`, `repo`,
and `pagesBaseUrl` in `src/Config.gs`.

### 3. Enable GitHub Pages

Repo → **Settings → Pages**:
- Source: **Deploy from a branch**
- Branch: **main** / folder: **/docs**
- Save.

After ~30 sec, you should be able to load:
```
https://zeroth-agents.github.io/pyrana-podcasts/cover.png
```

### 4. Create a fine-grained Personal Access Token

GitHub → profile → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- **Resource owner**: zeroth-agents (or your account)
- **Repository access**: Only select repositories → `pyrana-podcasts`
- **Repository permissions** → Contents: **Read and write**
- Expiration: 1 year (set a calendar reminder to rotate)

Copy the `github_pat_...` token.

### 5. Create the Apps Script project

```bash
npm install
npx clasp login
npx clasp create --type standalone --title "PYRANA Podcast Bot" --rootDir ./src
npx clasp push
```

Then `npx clasp open` to open it in the browser.

(If you'd rather skip clasp: create a project at https://script.google.com/, add a file for each `.gs` in `src/`, paste the contents.)

### 6. Configure Script Properties

Apps Script editor → **Project Settings (gear) → Script Properties → Add script property**.

Add three properties:

| Property name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `ELEVENLABS_API_KEY` | your ElevenLabs key |
| `GITHUB_TOKEN` | `github_pat_...` from step 4 |

Save.

### 7. Run setup steps in order

In the editor's function dropdown, run each of these once. The first time you run any function, Google will prompt for permissions — approve them all (Gmail, external URL access, triggers).

| Function | What it does |
|---|---|
| `setup_1_validateGithub` | Confirms the PAT works, cover art is committed, Pages is live |
| `setup_2_dryRun` | Tests Claude + ElevenLabs with tiny calls |
| `setup_3_firstEpisode` | Generates the first real episode end-to-end (~3 min) |
| `setup_4_getFeedUrl` | Prints your RSS feed URL — copy this |
| `setup_5_installTrigger` | Installs the hourly autopilot |

After `setup_3_firstEpisode`, check the **execution log** (View → Executions). The first episode MP3 will appear in `docs/episodes/` on GitHub.

### 8. Submit your RSS feed to Spotify

1. Go to https://podcasters.spotify.com/
2. Sign in with whatever Spotify account you want the show under
3. **Add or claim a podcast** → "I already have a podcast" → paste the RSS URL from `setup_4_getFeedUrl`
4. Spotify validates the feed (~30 sec) and asks for category/language confirmation
5. Approve → Spotify starts indexing

Episode appears in Spotify within 1–24 hours of feed submission. After that, every new entry in your RSS gets pulled automatically — usually within 1–4 hours of publish.

### 9. (Optional) Submit to Apple Podcasts

Same RSS feed works for Apple, Overcast, Pocket Casts, etc.
- Apple: https://podcastsconnect.apple.com/
- Others: usually auto-discover via Apple

---

## Verifying it works

After `setup_5_installTrigger`:

1. **View → Executions** — you'll see hourly runs starting
2. Tomorrow morning, after the next PYRANA email lands, check the repo's `docs/episodes/` folder around 1 hour later — a new MP3 should appear as a commit
3. Spotify pulls the new episode within a few hours of that

---

## Adjusting the show

| Want to change... | Edit |
|---|---|
| Voices | `Config.gs` → `ELEVENLABS.voiceA` / `voiceB` (browse https://elevenlabs.io/app/voice-library) |
| Episode length | `Config.gs` → `CLAUDE.targetMinutes` |
| Show title / description | `Config.gs` → `PODCAST.*` |
| Cover art | Replace `docs/cover.png` (1400×1400 PNG) and commit |
| Host personalities, structure | `Claude.gs` → `systemPrompt` |
| Frequency | Reinstall trigger with `everyMinutes()` or `everyHours(N)` |
| Pause everything | Delete trigger from **Triggers** (left sidebar in Apps Script) |
| Custom domain | Point CNAME at `<owner>.github.io`, update `pagesBaseUrl` in Config |

---

## Troubleshooting

**`GITHUB_TOKEN not set`** → Add it to Script Properties.

**GitHub returns 401** → Token wrong, expired, or missing the Contents:write permission on this repo.

**GitHub returns 404 from `setup_1_validateGithub`** → Cover art not committed at `docs/cover.png`, or `CONFIG.GITHUB.owner`/`repo` are wrong.

**Pages probe 404** → Pages not enabled, or still propagating (wait 1–2 min after first enabling).

**ElevenLabs returns 401** → Wrong API key. Re-copy from your ElevenLabs profile.

**ElevenLabs returns 402** → Out of credits. Check your subscription quota.

**Spotify rejects the feed** → Open the feed URL in a browser; it should be valid XML with an `<itunes:image>` tag pointing at a real PNG. If the cover URL 404s, fix the cover commit.

**Script timeout (6 min limit)** → Episodes longer than ~10 min may exceed Apps Script's runtime limit. Reduce `targetMinutes` in Config.

**Scripts produce weird pronunciation** → Edit the system prompt in `Claude.gs` to add specific guidance, or pre-process the email body to expand abbreviations.

---

## What this does NOT do

- Doesn't intro-mix music or sound effects (could add via additional ElevenLabs Sound Effects API calls)
- Doesn't chapter markers (Spotify supports them via RSS extension; not implemented here)
- Doesn't transcribe — the script itself isn't published, only audio
- Doesn't handle multiple newsletters (single sender for now; trivial to extend the Gmail query)

If you want any of those, they're each ~30 lines of additional code.
