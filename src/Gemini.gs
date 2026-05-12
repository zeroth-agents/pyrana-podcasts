/**
 * Gemini multi-speaker TTS client.
 *
 * Formats two-host dialogue into Gemini's expected prompt shape and
 * returns one or more chunks of raw PCM audio (24kHz, 16-bit, mono).
 *
 * Per-call output length is capped on Gemini's side (~minutes), so a
 * 12-min episode is split into chunks of ~CHUNK_TARGET_WORDS words.
 * Each chunk is a self-contained generateContent call.
 *
 * Returned chunks are concatenated and encoded to MP3 by Audio.gs.
 */

// Tuned for Gemini TTS preview output cap. Each chunk should fit
// comfortably in one response. Larger = fewer round-trips, but risk of
// the model truncating audio. 250 words ≈ ~100s at 150 wpm.
const GEMINI_CHUNK_TARGET_WORDS = 250;

// Gemini multi-speaker TTS uses literal speaker name strings in the
// prompt and the speakerVoiceConfigs map. We pick simple human names.
const GEMINI_SPEAKER_A = 'Alex';
const GEMINI_SPEAKER_B = 'Jordan';

/**
 * Synthesize the full episode. Returns:
 *   { sampleRate, channels, bitsPerSample, pcmChunks: [Uint8Array, ...] }
 *
 * Caller (Audio.gs) streams pcmChunks through the MP3 encoder.
 */
function synthesizeEpisode(scriptTurns) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_API_KEY');
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set in Script Properties');

  const chunks = chunkScript(scriptTurns, GEMINI_CHUNK_TARGET_WORDS);
  Logger.log('    📦 ' + chunks.length + ' TTS chunk(s)');

  const pcmChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    Logger.log('    🎙️  chunk ' + (i + 1) + '/' + chunks.length +
               ' (' + chunks[i].turns.length + ' turns, ~' + chunks[i].words + ' words)');
    const pcm = synthesizeChunk(apiKey, chunks[i].turns);
    pcmChunks.push(pcm);
    // Polite gap between calls.
    Utilities.sleep(500);
  }

  return {
    sampleRate: CONFIG.GEMINI.sampleRate,
    channels: 1,
    bitsPerSample: 16,
    pcmChunks: pcmChunks,
  };
}

/**
 * Group turns into chunks of roughly target word count, breaking on
 * speaker boundaries (never mid-turn).
 */
function chunkScript(turns, targetWords) {
  const chunks = [];
  let current = { turns: [], words: 0 };

  for (const turn of turns) {
    const w = countWords(turn.text);
    if (current.words + w > targetWords && current.turns.length > 0) {
      chunks.push(current);
      current = { turns: [], words: 0 };
    }
    current.turns.push(turn);
    current.words += w;
  }
  if (current.turns.length) chunks.push(current);
  return chunks;
}

function countWords(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Render turns as a multi-speaker prompt and call Gemini once.
 * Returns a Uint8Array of raw PCM bytes (24kHz, 16-bit, mono, little-endian).
 */
function synthesizeChunk(apiKey, turns) {
  const lines = ['TTS the following conversation between ' +
                 GEMINI_SPEAKER_A + ' and ' + GEMINI_SPEAKER_B + ':'];
  for (const t of turns) {
    const speaker = t.speaker === 'A' ? GEMINI_SPEAKER_A : GEMINI_SPEAKER_B;
    lines.push(speaker + ': ' + t.text);
  }
  const prompt = lines.join('\n');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: GEMINI_SPEAKER_A,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: CONFIG.GEMINI.voiceA } },
            },
            {
              speaker: GEMINI_SPEAKER_B,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: CONFIG.GEMINI.voiceB } },
            },
          ],
        },
      },
    },
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              CONFIG.GEMINI.model + ':generateContent?key=' + encodeURIComponent(apiKey);

  // Retry transient errors (5xx, 429). Gemini TTS occasionally returns
  // 500 INTERNAL on otherwise-fine prompts, especially right after a
  // billing/quota state change.
  let response = null;
  let code = 0;
  const RETRY_DELAYS_MS = [2000, 5000, 10000];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    code = response.getResponseCode();
    if (code === 200) break;
    const transient = (code >= 500 && code < 600) || code === 429;
    if (!transient || attempt === RETRY_DELAYS_MS.length) {
      throw new Error('Gemini TTS error ' + code + ': ' +
                      response.getContentText().slice(0, 800));
    }
    Logger.log('    ⟳  Gemini ' + code + ', retrying in ' +
               (RETRY_DELAYS_MS[attempt] / 1000) + 's (attempt ' +
               (attempt + 1) + '/' + RETRY_DELAYS_MS.length + ')');
    Utilities.sleep(RETRY_DELAYS_MS[attempt]);
  }

  const data = JSON.parse(response.getContentText());
  const inlineData = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  for (const part of inlineData) {
    if (part.inlineData && part.inlineData.data) {
      // Apps Script's Utilities.base64Decode returns byte[] (signed int8).
      // We convert to Uint8Array for downstream Int16 conversion.
      const bytes = Utilities.base64Decode(part.inlineData.data);
      const u8 = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        u8[i] = bytes[i] & 0xff;
      }
      return u8;
    }
  }
  throw new Error('Gemini TTS returned no audio. Response: ' +
                  response.getContentText().slice(0, 800));
}
