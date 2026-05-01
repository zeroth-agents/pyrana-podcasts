/**
 * ElevenLabs API client.
 * Synthesizes each dialogue turn with the appropriate voice and
 * concatenates the MP3s into a single episode file.
 */

function generateAudio(scriptTurns) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ELEVENLABS_API_KEY');
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set in Script Properties');

  const audioBlobs = [];
  for (let i = 0; i < scriptTurns.length; i++) {
    const turn = scriptTurns[i];
    const voiceId = turn.speaker === 'A' ? CONFIG.ELEVENLABS.voiceA : CONFIG.ELEVENLABS.voiceB;

    if (i % 5 === 0) {
      Logger.log('    turn ' + (i + 1) + '/' + scriptTurns.length);
    }

    const blob = synthesizeTurn(apiKey, voiceId, turn.text);
    audioBlobs.push(blob);

    // Small pause to be polite to the API.
    Utilities.sleep(300);
  }

  return concatenateMp3Blobs(audioBlobs);
}

function synthesizeTurn(apiKey, voiceId, text) {
  const url = 'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'xi-api-key': apiKey,
      'accept': 'audio/mpeg',
    },
    payload: JSON.stringify({
      text: text,
      model_id: CONFIG.ELEVENLABS.model,
      voice_settings: CONFIG.ELEVENLABS.voiceSettings,
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('ElevenLabs error ' + code + ': ' + response.getContentText().slice(0, 500));
  }

  return response.getBlob();
}

/**
 * Concatenates multiple MP3 blobs into one. Works because MP3 is a
 * stream-of-frames format — naive byte concatenation produces a valid
 * playable file. Most podcast players handle this fine.
 */
function concatenateMp3Blobs(blobs) {
  let totalLength = 0;
  const byteArrays = blobs.map(function (b) {
    const arr = b.getBytes();
    totalLength += arr.length;
    return arr;
  });

  const combined = new Array(totalLength);
  let offset = 0;
  for (const arr of byteArrays) {
    for (let i = 0; i < arr.length; i++) {
      combined[offset + i] = arr[i];
    }
    offset += arr.length;
  }

  return Utilities.newBlob(combined, 'audio/mpeg', 'episode.mp3');
}
