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
