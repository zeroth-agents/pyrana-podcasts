# pyrana-podcasts

Fully automated pipeline that turns daily **PYRANA Research Intelligence** emails into a private Spotify podcast. No clicks, no manual steps after one-time setup.

```
PYRANA email lands in Gmail
        ↓
Apps Script trigger fires (hourly)
        ↓
Apps Script extracts paper links and fetches their content
        ↓
Claude does a research pass over digest + papers, then writes a 2-host script
        ↓
Gemini multi-speaker TTS renders the conversation; vendored lamejs encodes MP3
        ↓
Apps Script commits MP3 + RSS feed to this repo
        ↓
GitHub Pages serves them at a stable public URL
        ↓
Spotify polls the RSS, pulls new episodes within a few hours
        ↓
You listen on Spotify while doing yard work
```

---

## What's in this repo

```
pyrana-podcasts/
├── README.md
├── SETUP.md               ← Detailed deployment walkthrough
├── LICENSE
├── package.json           ← clasp dependency
├── .clasp.json.example    ← Template for clasp deployment
├── .gitignore
├── docs/                  ← Served by GitHub Pages
│   ├── cover.png          ← 1400×1400 podcast cover art
│   ├── podcast.xml        ← RSS feed (created on first run)
│   └── episodes/          ← MP3s (one per email)
└── src/                   ← Apps Script source
    ├── appsscript.json    ← Manifest (OAuth scopes, runtime)
    ├── Code.gs            ← Main loop. Idempotent email processing.
    ├── Config.gs          ← Voices, episode length, podcast metadata, repo coords.
    ├── Papers.gs          ← Extracts arXiv/paper links and fetches source text.
    ├── Claude.gs          ← Two-pass: research notes → 2-host dialogue.
    ├── Gemini.gs          ← Multi-speaker TTS (returns 24kHz PCM chunks).
    ├── Audio.gs           ← Streams PCM through lamejs to produce MP3.
    ├── LameJs.gs          ← Vendored pure-JS MP3 encoder (lamejs).
    ├── Github.gs          ← Commits MP3s + RSS via GitHub API.
    ├── RSS.gs             ← Pure RSS XML build/parse.
    └── Setup.gs           ← One-time setup helpers, run in order.
```

---

## Why GitHub Pages instead of Drive

The earlier prototype used `drive.google.com/uc?export=download` URLs to host the MP3s and RSS feed. That works, intermittently — Google throttles unauthenticated downloads, the URL pattern keeps changing, and Spotify often refuses to validate Drive feeds.

GitHub Pages gives us:
- A stable, CDN-backed URL (`https://<owner>.github.io/<repo>/...`)
- Version history of every episode (it's just commits)
- Free hosting well within the 100 GB/month bandwidth allowance
- Optional custom domain (`podcasts.pyrana.ai`) with one DNS record

The only moving parts the bot writes to are `docs/episodes/*.mp3` and `docs/podcast.xml`. Everything else in the repo is static.

---

## Cost reality

Daily ~12-min episodes × 30/month with the two-pass Claude pipeline + Gemini TTS:

| Component | Per episode | Per month |
|---|---|---|
| Claude (research pass, Sonnet) | ~$0.05 | ~$1.50 |
| Claude (script pass, Opus) | ~$0.30–0.50 | ~$10–15 |
| Gemini multi-speaker TTS | ~$0.10–0.20 | ~$3–6 |
| Apps Script, GitHub Pages, Spotify ingestion | free | free |

Total ≈ **$15–25/month** for daily 12-min episodes — roughly a quarter of the prior ElevenLabs Pro setup.

---

## Quick start

The full step-by-step is in **SETUP.md**. The TL;DR:

1. **Enable GitHub Pages** on this repo: Settings → Pages → Source: *Deploy from a branch* → `main` / `/docs`.
2. **Create a fine-grained PAT** with `Contents: read+write` on this repo only.
3. **Push the Apps Script code**:
   ```bash
   npm install
   npx clasp login
   npx clasp create --type standalone --title "PYRANA Podcast Bot" --rootDir ./src
   npx clasp push
   ```
4. **Set Script Properties** in the Apps Script editor (Project Settings → Script Properties):
   ```
   ANTHROPIC_API_KEY    = sk-ant-...           (Azure KV: demos-anthropic-api-key)
   GOOGLE_API_KEY       = ...                  (Azure KV: demos-google-gemini-api-key)
   GITHUB_TOKEN         = github_pat_...
   ```
5. **Run setup steps in order** from the function dropdown:

   | Function | What it does | Time |
   |---|---|---|
   | `setup_1_validateGithub` | Confirms PAT works, cover art is committed, Pages is live | ~5 sec |
   | `setup_2_dryRun` | Validates Claude, Gemini TTS, and lamejs with tiny test calls | ~15 sec |
   | `setup_2b_testGemini` | (Optional) Renders a 1-min test clip to Drive so you can listen to the voices | ~30 sec |
   | `setup_3_firstEpisode` | Generates first real episode end-to-end | ~3 min |
   | `setup_4_getFeedUrl` | Prints RSS URL for Spotify submission | instant |
   | `setup_5_installTrigger` | Installs hourly autopilot | instant |

6. **Submit RSS to Spotify** at https://podcasters.spotify.com/ → "I already have a podcast" → paste the URL from step 4.

After step 5, the bot runs on its own. Every new PYRANA email becomes a Spotify episode within ~2 hours.

---

## Adjusting the show

| Want to change... | Edit |
|---|---|
| Voices | `src/Config.gs` → `GEMINI.voiceA` / `voiceB` (catalog: Kore, Puck, Charon, Aoede, Fenrir, Leda, Orus, Zephyr, Achernar) |
| Episode length | `src/Config.gs` → `CLAUDE.targetMinutes` |
| Show title / description | `src/Config.gs` → `PODCAST.*` |
| Cover art | Replace `docs/cover.png` (1400×1400 PNG) and commit |
| Host personalities, structure | `src/Claude.gs` → research and script `system` prompts |
| Source-paper depth | `src/Papers.gs` → `PAPERS_MAX_*` constants |
| Frequency | Reinstall trigger with `everyMinutes(N)` or `everyHours(N)` in `Setup.gs` |
| Pause everything | Delete trigger from Apps Script → Triggers (left sidebar) |
| Custom domain | Add a CNAME to `<owner>.github.io`, set `pagesBaseUrl` in `Config.gs` |

---

## What this does NOT do (yet)

- No intro/outro music or sound effects
- No chapter markers
- No transcript publishing (audio only)
- Single sender (PYRANA) — extending the Gmail query to multiple newsletters is a one-line change

Each is a small extension if you want them later.

---

## Architecture notes for future-you

- **Idempotency**: `LAST_PROCESSED_TIMESTAMP` cursor in Script Properties. Failed runs don't advance the cursor, so they retry next trigger. The RSS feed itself also dedupes on file path.
- **Two-pass Claude**: Pass 1 (Sonnet) reads the digest plus fetched paper sources and writes structured deep notes. Pass 2 (Opus) writes dialogue grounded in those notes. Notes are the only source of truth for the script — papers are not re-read in pass 2.
- **TTS chunking**: Gemini multi-speaker has a per-call output cap, so the script is split into ~250-word chunks. Each chunk is a single API call returning 24kHz 16-bit mono PCM.
- **MP3 encoding**: PCM chunks are streamed through `lamejs` (vendored as `LameJs.gs`) so we never hold the full ~34 MB of raw audio in memory. Output is 64 kbps mono — clear for speech, ~6 MB per 12-min episode.
- **RSS feed**: Stored at `docs/podcast.xml`, served via Pages. Capped at 50 most recent episodes.
- **GitHub commits**: Each episode is two commits (MP3, then RSS). `commitAuthor` in Config controls how they show up in `git log`.
- **Apps Script time limit**: 6 minutes. Gemini multi-speaker is much faster than per-turn ElevenLabs synthesis (a few API calls vs ~150), so 12-min episodes fit. If you push past 15 min, watch the trigger budget.
- **Bandwidth**: Spotify rehosts MP3s after first ingest, so ongoing GitHub Pages bandwidth is mostly the RSS XML — well under any limit.
