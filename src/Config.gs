/**
 * Configuration for the PYRANA podcast bot.
 *
 * Secrets live in Script Properties — never paste them here.
 * Set them via:  Project Settings → Script Properties → Add property
 *
 *   ANTHROPIC_API_KEY     — sk-ant-...
 *   ELEVENLABS_API_KEY    — your ElevenLabs API key
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
    owner: 'zeroth-technology',
    repo: 'pyrana-podcasts',
    branch: 'main',
    // Path inside the repo where Pages serves from. Must match the
    // Pages settings in the GitHub repo (Settings → Pages → /docs).
    publishDir: 'docs',
    // Public Pages base URL. If you use a custom domain, change this.
    // Format with no trailing slash:
    //   https://<owner>.github.io/<repo>
    //   https://podcasts.example.com
    pagesBaseUrl: 'https://zeroth-technology.github.io/pyrana-podcasts',
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
  CLAUDE: {
    model: 'claude-sonnet-4-6',
    maxTokens: 4000,
    targetMinutes: 5,
  },

  // ─── ElevenLabs (audio synthesis) ─────────────────────────────────
  ELEVENLABS: {
    voiceA: '21m00Tcm4TlvDq8ikWAM',  // Rachel — warm, conversational
    voiceB: 'pNInz6obpgDQGcFmaJgB',  // Adam — deep, authoritative
    model: 'eleven_turbo_v2_5',
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
      use_speaker_boost: true,
    },
  },
};
