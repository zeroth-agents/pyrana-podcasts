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
Apps Script extracts paper links from the email and fetches their content
    ↓
Claude does a research pass (digest + papers) → structured deep notes
    ↓
Claude writes a 2-host podcast script grounded in those notes
    ↓
Gemini multi-speaker TTS renders the conversation (24kHz PCM)
    ↓
Vendored lamejs encodes PCM → MP3 in-process
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

Daily 12-min episodes with the two-pass Claude pipeline + Gemini TTS:

| Service | Per episode | Per month (daily) | Notes |
|---|---|---|---|
| Anthropic — Sonnet (research pass) | ~$0.05 | ~$1.50 | Reads digest + fetched papers |
| Anthropic — Opus (script pass) | ~$0.30–0.50 | ~$10–15 | Where dialogue quality lives |
| Gemini multi-speaker TTS | ~$0.10–0.20 | ~$3–6 | Pay-as-you-go, no minimum |
| Google Apps Script | Free | Free | Generous free quota |
| GitHub Pages | Free | Free | 100 GB/mo bandwidth, plenty |
| Spotify for Podcasters | Free | Free | RSS ingestion is free |

**Total ≈ $15–25/month** for daily coverage. Roughly a quarter of the prior ElevenLabs Pro setup.

---

## One-time setup (~30 min)

### 1. Get the API keys

**Anthropic** — pull from Azure Key Vault:
```bash
az keyvault secret show --vault-name pyrana-demo --name demos-anthropic-api-key --query value -o tsv
```

**Gemini** — same pattern:
```bash
az keyvault secret show --vault-name pyrana-demo --name demos-google-gemini-api-key --query value -o tsv
```

If you don't have these in KV yet, create them at https://console.anthropic.com/ and https://aistudio.google.com/app/apikey and store them.

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
| `GOOGLE_API_KEY` | your Gemini API key |
| `GITHUB_TOKEN` | `github_pat_...` from step 4 |

Save.

### 7. Run setup steps in order

In the editor's function dropdown, run each of these once. The first time you run any function, Google will prompt for permissions — approve them all (Gmail, external URL access, triggers).

| Function | What it does |
|---|---|
| `setup_1_validateGithub` | Confirms the PAT works, cover art is committed, Pages is live |
| `setup_2_dryRun` | Tests Claude, Gemini TTS, and lamejs encoder with tiny calls |
| `setup_2b_testGemini` | Optional: renders a 1-min test clip to your Drive so you can listen to the voices first |
| `setup_3_firstEpisode` | Generates the first real episode end-to-end (~4–5 min) |
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
| Voices | `Config.gs` → `GEMINI.voiceA` / `voiceB`. Try Kore, Puck, Charon, Aoede, Fenrir, Leda, Orus, Zephyr, Achernar — preview combos with `setup_2b_testGemini`. |
| Episode length | `Config.gs` → `CLAUDE.targetMinutes` |
| Show title / description | `Config.gs` → `PODCAST.*` |
| Cover art | Replace `docs/cover.png` (1400×1400 PNG) and commit |
| Host personalities, structure | `Claude.gs` → research and script `system` prompts |
| Source-paper depth | `Papers.gs` → `PAPERS_MAX_*` constants (per-paper and total char caps) |
| Frequency | Reinstall trigger with `everyMinutes()` or `everyHours(N)` |
| Pause everything | Delete trigger from **Triggers** (left sidebar in Apps Script) |
| Custom domain | Point CNAME at `<owner>.github.io`, update `pagesBaseUrl` in Config |

---

## Troubleshooting

**`GITHUB_TOKEN not set`** → Add it to Script Properties.

**GitHub returns 401** → Token wrong, expired, or missing the Contents:write permission on this repo.

**GitHub returns 404 from `setup_1_validateGithub`** → Cover art not committed at `docs/cover.png`, or `CONFIG.GITHUB.owner`/`repo` are wrong.

**Pages probe 404** → Pages not enabled, or still propagating (wait 1–2 min after first enabling).

**Gemini TTS returns 401/403** → Wrong `GOOGLE_API_KEY`, or the key isn't enabled for the Generative Language API. Re-issue at https://aistudio.google.com/app/apikey.

**Gemini TTS returns 400 with "model not found"** → The TTS preview model name has rotated. Update `CONFIG.GEMINI.model` to the current Gemini multi-speaker TTS model.

**`Gemini TTS returned no audio`** → Usually means the model rejected the prompt (safety, length, or formatting). Check the response body in the log; shorten the chunk by lowering `GEMINI_CHUNK_TARGET_WORDS` in `Gemini.gs`.

**Encoder produces silent or garbled MP3** → Sample-rate mismatch. `CONFIG.GEMINI.sampleRate` must equal Gemini's actual output rate (24000 today).

**Spotify rejects the feed** → Open the feed URL in a browser; it should be valid XML with an `<itunes:image>` tag pointing at a real PNG. If the cover URL 404s, fix the cover commit.

**Script timeout (6 min limit)** → Episodes past ~15 min may exceed Apps Script's runtime. Reduce `CLAUDE.targetMinutes` in Config, or lower `MP3_BITRATE_KBPS` if the encoder pass is the bottleneck.

**Scripts produce weird pronunciation** → Edit the system prompt in `Claude.gs` to add specific guidance, or pre-process the email body to expand abbreviations.

---

## What this does NOT do

- Doesn't intro-mix music or sound effects (would require pre-rendered clips committed to the repo and concatenated in Audio.gs)
- Doesn't chapter markers (Spotify supports them via RSS extension; not implemented here)
- Doesn't transcribe — the script itself isn't published, only audio
- Doesn't handle multiple newsletters (single sender for now; trivial to extend the Gmail query)

If you want any of those, they're each ~30 lines of additional code.
