/**
 * Configuration for the PYRANA podcast bot.
 *
 * Secrets live in Script Properties — never paste them here.
 * Set them via:  Project Settings → Script Properties → Add property
 *
 *   ANTHROPIC_API_KEY     — sk-ant-...
 *   GOOGLE_API_KEY        — Gemini API key (multi-speaker TTS)
 *   GITHUB_TOKEN          — fine-grained PAT, Contents: read+write on the host repo
 *   PARALLEL_API_KEY      — Parallel Search API key (deeper-compare step; optional)
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
    // Builder context — threaded into both Claude prompts so the hosts
    // speak as part of the Zeroth team building PYRANA and the Cortex
    // Context Engine, not as generic narrators. Refine freely; this is
    // the substrate the model uses for "we" / "our work" framing.
    buildContext:
      'The hosts work at Zeroth Agents on PYRANA, a platform for building ' +
      'governed AI agents whose knowledge is structured as Context Units ' +
      '(CxUs) — atomic, content-addressable claims with attached supporting ' +
      'context, lifecycle, and audit trail. The Cortex Context Engine is the ' +
      'knowledge layer underneath PYRANA: papers and policies go in, CxUs ' +
      'come out, and downstream agents read CxUs instead of raw text. The ' +
      'podcast itself is an internal feedback loop — what landed in the daily ' +
      'PYRANA Research Intelligence digest, what it means for the platform ' +
      'roadmap, what we should be building or revisiting in response.',
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
    researchMaxTokens: 8000,
    scriptMaxTokens: 16000,
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

  // ─── Parallel.ai (deeper compare) ─────────────────────────────────
  // Before the research pass, we use Parallel's Search API to pull real
  // prior/related work from the web for each paper. Those excerpts are
  // threaded into the research notes so "Field connection" and the
  // steel-manned objection are grounded in retrieved sources instead of
  // model memory.
  //
  // Set PARALLEL_API_KEY in Script Properties to enable. If the key is
  // absent, disabled here, or the API errors, the pipeline degrades
  // gracefully: episodes still publish without the compare, and the
  // show-notes credit will NOT claim it ran. The Search API is synchronous
  // (one POST per paper) — unlike the async Task API it stays inside the
  // 6-minute Apps Script execution ceiling.
  PARALLEL: {
    enabled: true,
    endpoint: 'https://api.parallel.ai/v1/search',
    maxPapersToCompare: 3,    // cap searches to protect the time budget
    maxResultsPerPaper: 5,    // enforced client-side (API has no such param)
    maxCharsPerResult: 2000,  // enforced client-side (excerpt truncation)
  },

  // ─── Production credit (show-notes footer) ────────────────────────
  // Bump agentVersion when the pipeline changes materially (new model,
  // new stage) so listeners can tell which generation produced an episode.
  // Model names in the footer are derived from CONFIG above, so they stay
  // accurate automatically when you swap models.
  PRODUCTION: {
    agentVersion: 'v1.1',     // v1.1 adds the Parallel deeper-compare stage
  },
};
