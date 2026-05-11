/**
 * Audio pipeline: PCM chunks (from Gemini) → MP3 blob (for the feed).
 *
 * Why streaming: a 12-minute episode at 24kHz mono 16-bit is ~34 MB of
 * PCM. Holding all of it in memory before encoding works in theory but
 * is wasteful. lamejs' Mp3Encoder is incremental — feed it Int16 frames,
 * collect MP3 bytes per call, flush at the end. Memory peak stays at
 * one chunk's PCM (~3 MB) + the growing MP3 buffer (~6 MB total).
 */

// Encode bitrate. 64 kbps mono is plenty for podcast speech and keeps
// 12-min episodes under 6 MB — well within the GitHub Pages bandwidth
// budget and fast for Spotify ingestion.
const MP3_BITRATE_KBPS = 64;

// lamejs encodes in fixed-size sample blocks. 1152 is the standard
// MP3 frame size; processing in multiples of this avoids edge cases.
const MP3_SAMPLES_PER_BLOCK = 1152;

/**
 * Encode the synthesizeEpisode() result into an MP3 blob.
 *
 *   pcm = { sampleRate, channels, bitsPerSample, pcmChunks: [Uint8Array...] }
 */
function encodePcmToMp3(pcm) {
  if (pcm.channels !== 1) {
    throw new Error('Only mono PCM is supported (got ' + pcm.channels + ' channels)');
  }
  if (pcm.bitsPerSample !== 16) {
    throw new Error('Only 16-bit PCM is supported (got ' + pcm.bitsPerSample + ')');
  }

  const encoder = new lamejs.Mp3Encoder(1, pcm.sampleRate, MP3_BITRATE_KBPS);
  const mp3Parts = [];
  let totalSamples = 0;

  for (let c = 0; c < pcm.pcmChunks.length; c++) {
    const u8 = pcm.pcmChunks[c];
    if (!u8 || u8.length < 2) continue;

    // Strip a WAV header if Gemini ever returns one (defensive — current
    // responses are raw PCM).
    let offset = 0;
    if (u8.length >= 44 &&
        u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) {
      offset = parseWavHeaderEnd(u8);
    }

    const i16 = pcmBytesToInt16(u8, offset);
    totalSamples += i16.length;

    // Encode in 1152-sample blocks (standard MP3 frame size).
    let pos = 0;
    while (pos + MP3_SAMPLES_PER_BLOCK <= i16.length) {
      const block = i16.subarray(pos, pos + MP3_SAMPLES_PER_BLOCK);
      const enc = encoder.encodeBuffer(block);
      if (enc.length > 0) mp3Parts.push(enc);
      pos += MP3_SAMPLES_PER_BLOCK;
    }
    // Tail: encode any remaining samples in this chunk in one go.
    // (lamejs handles non-1152-aligned buffers; aligning is for cleanliness.)
    if (pos < i16.length) {
      const tail = i16.subarray(pos);
      const enc = encoder.encodeBuffer(tail);
      if (enc.length > 0) mp3Parts.push(enc);
    }
  }

  const flush = encoder.flush();
  if (flush.length > 0) mp3Parts.push(flush);

  const mp3Bytes = concatInt8(mp3Parts);
  Logger.log('    🎧 ' + Math.round(totalSamples / pcm.sampleRate) + 's audio → ' +
             Math.round(mp3Bytes.length / 1024) + ' KB MP3');

  return Utilities.newBlob(toRegularArray(mp3Bytes), 'audio/mpeg', 'episode.mp3');
}

/**
 * Convert little-endian 16-bit PCM bytes to an Int16Array view.
 * Avoids buffer copy when alignment permits.
 */
function pcmBytesToInt16(u8, byteOffset) {
  const start = byteOffset || 0;
  const usableLen = u8.length - start;
  const sampleCount = usableLen >> 1;  // floor to even byte count

  const i16 = new Int16Array(sampleCount);
  // Manual little-endian decode — Apps Script Uint8Array.buffer can be a
  // DataView-able ArrayBuffer, but we stay defensive across runtimes.
  for (let i = 0; i < sampleCount; i++) {
    const lo = u8[start + i * 2];
    const hi = u8[start + i * 2 + 1];
    let s = (hi << 8) | lo;
    if (s & 0x8000) s = s - 0x10000;  // sign-extend
    i16[i] = s;
  }
  return i16;
}

/**
 * Skip over a RIFF/WAVE header, returning the offset of the data chunk.
 * Defensive — only used if Gemini ever wraps PCM in WAV.
 */
function parseWavHeaderEnd(u8) {
  // RIFF size is at u8[4..8], format at u8[8..12]. Walk chunks from 12.
  let p = 12;
  while (p + 8 <= u8.length) {
    const tag = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    const size = u8[p + 4] | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24);
    if (tag === 'data') return p + 8;
    p += 8 + size;
  }
  return 0;  // header not found in a sane place; treat as raw PCM
}

/**
 * Concatenate Int8Arrays (lamejs returns those) into one Uint8Array.
 */
function concatInt8(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      out[offset + i] = p[i] & 0xff;
    }
    offset += p.length;
  }
  return out;
}

/**
 * Apps Script's Utilities.newBlob expects a regular Array<number> (bytes),
 * not Uint8Array. Convert.
 */
function toRegularArray(u8) {
  const arr = new Array(u8.length);
  for (let i = 0; i < u8.length; i++) {
    let b = u8[i];
    if (b > 127) b = b - 256;  // signed byte for newBlob
    arr[i] = b;
  }
  return arr;
}
