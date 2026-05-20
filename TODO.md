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
