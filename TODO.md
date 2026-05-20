# TODO

Planned improvements for the PYRANA podcast pipeline.

## Host voices & personalities

> Status: **done.** Accent (`GEMINI.styleB` = British) + per-chunk style
> direction for consistency (`src/Config.gs`, `src/Gemini.gs`) and the
> no-self-answer rule (`src/Claude.gs`) are implemented. Staying with **two**
> hosts — a third is tabled. Voice *drift* mitigation is best-effort until
> verified on real audio.

- **Distinct, consistent voices.** Two hosts, each with a clearly distinct voice
  and personality that engages the listener directly (`GEMINI.voiceA` / `voiceB`
  in `src/Config.gs`). A voice sometimes drifts subtly mid-episode — it shifts
  enough to notice without sounding like a different person. Each host should
  sound rock-solid consistent start to finish.
- **Consider an accent for one host** to make the two voices unmistakably
  different from each other.
- **Never let a host answer their own question.** A question raised by one host
  must be answered by another — never by the same speaker who asked it. Enforce
  this in the script-pass dialogue rules in `src/Claude.gs`.

## Technical level & "plain English" tic

> Status: **done.** Reframed the accessibility rules in `src/Claude.gs` to
> describe the target level, added an explicit ban on saying "in plain English"
> and its variants, and renamed the internal "Plain-English summary" label.

- **Stop the hosts from literally saying "in plain English."** The script prompt
  in `src/Claude.gs` instructs the hosts to explain things plainly (the phrase
  "plain English" / "plain version" appears throughout the prompt). The model has
  taken this too literally and the hosts repeatedly say the phrase out loud, which
  comes across as pedantic.
- **The actual goal is the right technical level.** Pitch the discussion so a
  listener can follow along without having read the paper — explain at that level
  by default, rather than narrating that they're about to simplify. Rework the
  prompt so "plain English" describes the target register, not a phrase the hosts
  announce.

## Compare papers to outside work via Parallel.ai (bigger)

> Status: **deferred** — blocked on a Parallel.ai account / API key.

**Goal.** Right now we only compare each paper to PYRANA/Cortex (the
"Connection to PYRANA/Cortex" line in the research pass). We don't compare a
paper to *other* papers or to what the wider field is saying/writing about it.
We want the hosts to situate each paper against related work and larger trends
in the space — a best-of-breed read that helps us make **roadmap decisions**
about what to build or revisit.

**Approach — wire in [Parallel.ai](https://parallel.ai/).** Parallel offers two
relevant APIs (auth via `x-api-key`):

- **Search API** — `POST https://api.parallel.ai/v1/search`, takes a natural-
  language `objective` plus optional `search_queries`, returns LLM-ready ranked
  URLs with excerpts. Synchronous. Good fit: per paper, an objective like
  "find recent related work, benchmarks, and commentary comparing approaches to
  <core claim>; what are the competing/best-of-breed methods and the broader
  trend?"
- **Task API** — `POST https://api.parallel.ai/v1/...` deep-research with
  structured output, citations, and calibrated confidence (their "Basis"
  framework). Heavier; may require polling a run id. Use if we want a structured
  comparative synthesis rather than raw excerpts.

Recommend starting with the **Search API per paper** (lighter, synchronous) and
considering the Task API later for deeper comparison.

**Implementation notes:**

- **No npm/PyPI SDK at runtime.** This is Google Apps Script — it can't run
  Parallel's TS/Python SDK. Integrate via REST using `UrlFetchApp.fetch`, the
  same pattern as `callClaude` in `src/Claude.gs` and the Gemini client. Add a
  new `src/Parallel.gs` module mirroring those.
- **Secret + config.** Add `PARALLEL_API_KEY` to Script Properties (document it
  in `Config.gs` header and `SETUP.md`), plus a `CONFIG.PARALLEL` block (model/
  processor tier, max results, per-paper char budget).
- **Where it feeds in.** Call Parallel during/before the research pass
  (`generateResearchNotes`, `src/Claude.gs`), once per covered paper. Feed the
  returned external context into the prompt so the existing **"Field connection"**
  line becomes grounded in real fetched sources, and add an explicit
  **"Comparative / best-of-breed"** block: how this paper stacks up against
  alternatives, and the roadmap implication for PYRANA/Cortex.
- **Latency budget.** Apps Script has a 6-minute execution cap. Extra
  per-paper network round-trips add up — keep it to the Search API (sync) at
  first, cap papers, and watch the trigger budget. The Task API's async polling
  is risky inside the 6-min window.
- **Account needed.** Requires a Parallel.ai account / API key (you'll provide);
  the rest can be wired up against the REST API.

## Variable episode length (15-min target, 30-min cap)

> Status: **done** (pending real-run verification). Added `CONFIG.CLAUDE.maxMinutes`
> (= 30) and made the script-pass length prompt adaptive in `src/Claude.gs`. Still
> need to confirm a max-length run fits the 6-min Apps Script cap.

**Goal.** Keep ~15 minutes as the *target*, but let richer days run longer — up
to a **30-minute cap** — when the material warrants it. Some papers (or a denser
batch) simply need more room than 15 minutes allows.

**Where it lives.** `CONFIG.CLAUDE.targetMinutes` (currently `15`) drives the
script pass in `src/Claude.gs`. Today the prompt builds a fixed
`targetWords = targetMinutes * 150` and enforces a hard **minimum** word floor
(`minWords`), so length is essentially pinned to the target with no headroom.

**Changes:**

- **Add a cap.** Introduce `CONFIG.CLAUDE.maxMinutes` (= `30`) alongside
  `targetMinutes` (stays `15`). Derive a `maxWords` ceiling the same way
  `targetWords` is derived (`maxMinutes * 150`).
- **Make length adaptive, not fixed.** Rework the script-pass prompt so 15 min
  is the default/target and the model is allowed to expand toward the 30-min cap
  *only when the notes justify it* (more papers, deeper mechanisms, a meaty
  steel-manned debate). Thin days should still come in around 15 — don't pad to
  fill time. Keep a sensible floor so short episodes don't collapse.
- **Per-paper budget scales.** The structure budget in the prompt is written for
  a 15-min episode; let the per-paper segment time scale with the chosen length
  rather than being hard-coded.

**Watch-outs:**

- **Apps Script 6-min cap.** A 30-min episode (~4500 words) means more Gemini
  TTS chunks and more API round-trips. Confirm a max-length run still finishes
  inside the 6-minute execution limit (see TTS chunking notes in `README.md`).
- **Token ceiling.** Check `CONFIG.CLAUDE.scriptMaxTokens` (currently `16000`)
  comfortably covers a 30-min script.

## "Lite" episodes from shared links / forwarded email (back burner)

> Low priority / back burner.

**Goal.** A lighter-weight episode format alongside the full PYRANA research
show. Instead of the two-pass deep research treatment, the hosts simply
**comment on** a set of links — or even **read them verbatim** — for a quick,
casual episode.

**Two input sources:**

1. **Links from the Zeroth Agents text thread.** Whatever links get dropped in
   the team's group text thread become episode fodder.
2. **Forwarded email / newsletter.** Forward an email or newsletter into the
   pipeline and have the hosts do the same thing — comment on it or read it
   verbatim.

**How it differs from the main show:**

- New, lighter Claude path (or prompt mode) in `src/Claude.gs` — skip the
  research-notes pass; either a "react/comment on these links" prompt or a
  near-verbatim read-through, depending on the item.
- Reuses the existing link-fetching (`src/Papers.gs`) and the TTS + publish
  path (`src/Gemini.gs`, `src/Audio.gs`, `src/Github.gs`, `src/RSS.gs`)
  unchanged. Could publish to the same feed or a separate "Lite" feed.

**Open question — ingestion path.** Apps Script reads **Gmail**, not SMS
directly (`CONFIG.GMAIL_QUERY` in `src/Config.gs`, consumed by the main loop in
`src/Code.gs`). Need to decide how a text thread reaches the pipeline:

- The forwarded-email case is easy — add a second Gmail query (e.g. a label or a
  dedicated forwarding address) and branch the main loop to the lite path.
- The text-thread case needs a bridge: e.g. forward the thread to Gmail (Google
  Voice / a forwarding number / a Shortcut that emails the links), then treat it
  like any other inbound email. Figure out the simplest reliable bridge before
  building.
