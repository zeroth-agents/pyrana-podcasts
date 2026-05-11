/**
 * Configuration for the PYRANA podcast bot.
 *
 * Secrets live in Script Properties — never paste them here.
 * Set them via:  Project Settings → Script Properties → Add property
 *
 *   ANTHROPIC_API_KEY     — sk-ant-...
 *   GOOGLE_API_KEY        — Gemini API key (multi-speaker TTS)
 *   GITHUB_TOKEN          — fine-grained PAT, Contents: read+write on the host repo
 *
 * Everything below is non-secret tuning you can edit freely.
 */

const CONFIG = {
  // ─── Gmail ────────────────────────────────────────────────────────
  GMAIL_QUERY: 'from:eric@zeroth.technology subject:"PYRANA Research"',

  // ─── GitHub Pages hosting ─────────────────────────────────────────
  // Audio files and the RSS feed are committed to this repo and served
  // via GitHub Pages from the /docs folder on the default branch.
  GITHUB: {
    owner: 'zeroth-agents',
    repo: 'pyrana-podcasts',
    branch: 'main',
    // Path inside the repo where Pages serves from. Must match the
    // Pages settings in the GitHub repo (Settings → Pages → /docs).
    publishDir: 'docs',
    // Public Pages base URL. If you use a custom domain, change this.
    // Format with no trailing slash:
    //   https://<owner>.github.io/<repo>
    //   https://podcasts.example.com
    pagesBaseUrl: 'https://zeroth-agents.github.io/pyrana-podcasts',
    // Author identity used on commits. Visible in git log.
    commitAuthor: { name: 'PYRANA Podcast Bot', email: 'jamey@zeroth.technology' },
  },

  // ─── Podcast metadata (shows in Spotify) ──────────────────────────
  PODCAST: {
    title: 'PYRANA Daily',
    description: 'Daily AI agent research, narrated. ' +
                 'Two hosts unpack the day\'s most interesting papers from PYRANA Research Intelligence.',
    author: 'Zeroth Agents',
    email: 'jamey@zeroth.technology',
    language: 'en-us',
    category: 'Technology',
    explicit: false,
    websiteUrl: 'https://pyrana.ai',
    // Cover art is committed at <publishDir>/cover.png.
    coverArtPath: 'cover.png',
  },

  // ─── Claude (script writing) ──────────────────────────────────────
  // Two-pass generation:
  //   researchModel reads the email + fetched papers and writes deep notes.
  //   scriptModel turns those notes into two-host dialogue.
  // Sonnet for research is plenty (it's structured extraction); Opus for
  // the script is where dialogue quality actually matters.
  CLAUDE: {
    researchModel: 'claude-sonnet-4-6',
    scriptModel: 'claude-opus-4-7',
    researchMaxTokens: 16000,
    scriptMaxTokens: 24000,
    targetMinutes: 15,
    // Floor the script length so Opus doesn't wrap up early when the
    // soft target is "~N minutes". 150 wpm × minutes × 0.85 floor.
    minWords: 1900,
  },

  // ─── Gemini (multi-speaker TTS) ───────────────────────────────────
  // Gemini's multi-speaker TTS produces NotebookLM-style two-host audio
  // in a single call per chunk. Output is 24kHz 16-bit mono PCM, which
  // we encode to MP3 in-process via vendored lamejs.
  //
  // Voice names: pick from the Gemini prebuilt voice catalog. Some
  // expressive options: Kore, Puck, Charon, Aoede, Fenrir, Leda, Orus,
  // Zephyr, Achernar. Mix-and-match for the host pairing you like.
  GEMINI: {
    model: 'gemini-2.5-flash-preview-tts',
    voiceA: 'Kore',     // HOST_A — warm
    voiceB: 'Charon',   // HOST_B — authoritative
    sampleRate: 24000,  // Gemini TTS output rate (don't change)
  },
};
