# pyrana-podcasts

Fully automated pipeline that turns daily **PYRANA Research Intelligence** emails into a private Spotify podcast. No clicks, no manual steps after one-time setup.

```
PYRANA email lands in Gmail
        ↓
Apps Script trigger fires (hourly)
        ↓
Claude writes a 2-host podcast script from the email
        ↓
ElevenLabs synthesizes the audio (one voice per host)
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
    ├── Claude.gs          ← Claude API. Generates dialogue.
    ├── ElevenLabs.gs      ← ElevenLabs API. Synthesizes & concatenates audio.
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

Daily ~5-min episodes × 30/month ≈ 150k characters of TTS.

| Tier | Monthly | Char allowance | Episodes/mo |
|---|---|---|---|
| ElevenLabs Creator | $22 | 100k | ~15–18 |
| ElevenLabs Pro | $99 | 500k | unlimited daily |
| OpenAI TTS (alt.) | ~$3–5 | pay-as-you-go | unlimited daily |
| Google Cloud TTS (alt.) | ~$1–2 | pay-as-you-go | unlimited daily |

Anthropic API is ~$0.10–0.30/episode. Apps Script, GitHub Pages, and Spotify ingestion are free.

For daily episodes on a budget: swap ElevenLabs for OpenAI TTS — `src/ElevenLabs.gs` is ~80 lines, replacing it is a one-evening job.

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
   ELEVENLABS_API_KEY   = ...                  (Azure KV: demos-eleven-labs-api-key)
   GITHUB_TOKEN         = github_pat_...
   ```
5. **Run setup steps in order** from the function dropdown:

   | Function | What it does | Time |
   |---|---|---|
   | `setup_1_validateGithub` | Confirms PAT works, cover art is committed, Pages is live | ~5 sec |
   | `setup_2_dryRun` | Validates Claude + ElevenLabs with tiny test calls | ~10 sec |
   | `setup_3_firstEpisode` | Generates first real episode end-to-end | ~3 min |
   | `setup_4_getFeedUrl` | Prints RSS URL for Spotify submission | instant |
   | `setup_5_installTrigger` | Installs hourly autopilot | instant |

6. **Submit RSS to Spotify** at https://podcasters.spotify.com/ → "I already have a podcast" → paste the URL from step 4.

After step 5, the bot runs on its own. Every new PYRANA email becomes a Spotify episode within ~2 hours.

---

## Adjusting the show

| Want to change... | Edit |
|---|---|
| Voices | `src/Config.gs` → `ELEVENLABS.voiceA` / `voiceB` |
| Episode length | `src/Config.gs` → `CLAUDE.targetMinutes` |
| Show title / description | `src/Config.gs` → `PODCAST.*` |
| Cover art | Replace `docs/cover.png` (1400×1400 PNG) and commit |
| Host personalities, structure | `src/Claude.gs` → `systemPrompt` |
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
- **MP3 concatenation**: Naive byte concat works because MP3 is a stream-of-frames format. Most podcast players handle the seam transparently.
- **RSS feed**: Stored at `docs/podcast.xml`, served via Pages. Capped at 50 most recent episodes.
- **GitHub commits**: Each episode is two commits (MP3, then RSS). `commitAuthor` in Config controls how they show up in `git log`.
- **Apps Script time limit**: 6 minutes. ~5-min episodes generate in 2–3 min including the GitHub commits. Longer episodes risk timeout.
- **Bandwidth**: Spotify rehosts MP3s after first ingest, so ongoing GitHub Pages bandwidth is mostly the RSS XML — well under any limit.
