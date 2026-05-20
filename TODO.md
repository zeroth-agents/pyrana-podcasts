# TODO

Planned improvements for the PYRANA podcast pipeline.

## Host voices & personalities

- **Distinct, consistent voices.** Have two or three hosts, each with a clearly
  distinct voice and personality that engages the listener directly. Today there
  are two (`GEMINI.voiceA` / `voiceB` in `src/Config.gs`), but a voice sometimes
  drifts subtly mid-episode — it shifts enough to notice without sounding like a
  different person. Each host should sound rock-solid consistent start to finish.
- **Consider an accent for one host** to make the two voices unmistakably
  different from each other.
- **Never let a host answer their own question.** A question raised by one host
  must be answered by another — never by the same speaker who asked it. Enforce
  this in the script-pass dialogue rules in `src/Claude.gs`.

## Technical level & "plain English" tic

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
