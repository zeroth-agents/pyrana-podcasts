/**
 * Claude API client.
 * Turns a PYRANA email into a two-host podcast script.
 */

function generatePodcastScript(subject, emailBody) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Script Properties');

  const systemPrompt =
    'You are head writer for "' + CONFIG.PODCAST.title + '", a daily AI research podcast.\n\n' +
    'Two hosts trade lines:\n' +
    '  HOST_A — warm, curious. Asks great questions. Sometimes summarizes for the listener.\n' +
    '  HOST_B — deep technical chops. Sharp opinions. Connects papers to the broader field.\n\n' +
    'Write a natural, conversational ~' + CONFIG.CLAUDE.targetMinutes + '-minute episode ' +
    'covering the day\'s research digest. Aim for roughly ' +
    (CONFIG.CLAUDE.targetMinutes * 150) + ' words total.\n\n' +
    'Structure:\n' +
    '  • Cold open: hook on the most interesting paper of the day\n' +
    '  • Walk through the top 2–4 papers conversationally\n' +
    '  • Connect to broader trends in agent architectures, AI safety, applied research\n' +
    '  • Banter naturally — light disagreement, jokes, "wait, say more about that"\n' +
    '  • Brief sign-off teasing tomorrow\n\n' +
    'CRITICAL FORMAT RULES:\n' +
    '  • Output ONLY alternating dialogue lines, nothing else\n' +
    '  • Every line starts with exactly "HOST_A: " or "HOST_B: "\n' +
    '  • No stage directions, no [music], no markdown, no preamble\n' +
    '  • No paper titles in italics or quotes — just say them naturally\n' +
    '  • Pronounceable: spell out acronyms first time ("OMOP, that\'s O-M-O-P...")\n' +
    '  • No URLs, no doc references like "see the tracker" — listener can\'t click\n\n' +
    'Tone: think Hard Fork meets Latent Space. Smart but not stiff. Two friends who happen to know a lot.';

  const userPrompt =
    'Today\'s email:\n\n' +
    'Subject: ' + subject + '\n\n' +
    emailBody + '\n\n' +
    'Write the script now. HOST_A starts.';

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model: CONFIG.CLAUDE.model,
      max_tokens: CONFIG.CLAUDE.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + response.getResponseCode() + ': ' + response.getContentText());
  }

  const data = JSON.parse(response.getContentText());
  const rawScript = (data.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n');

  return parseScript(rawScript);
}

function parseScript(rawScript) {
  const turns = [];
  const lines = rawScript.split('\n');
  for (const line of lines) {
    const m = line.match(/^HOST_(A|B):\s*(.+)$/);
    if (m) {
      turns.push({
        speaker: m[1],
        text: cleanLine(m[2]),
      });
    }
  }
  if (turns.length === 0) {
    throw new Error('Could not parse any HOST_A/HOST_B turns from script. Raw output:\n' + rawScript);
  }
  return turns;
}

function cleanLine(text) {
  // Strip markdown emphasis, trailing whitespace, etc.
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}
