/**
 * Claude API client.
 *
 * Two-pass generation:
 *   1. researchPass(email, papers) → structured deep notes
 *   2. scriptPass(notes)           → two-host dialogue
 *
 * The research pass reads the actual fetched papers (not just the
 * digest) and produces specific, defensible claims. The script pass
 * writes from those notes — so the hosts sound like they read the
 * papers, because the notes did.
 */

function callClaude(model, maxTokens, system, userText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Script Properties');

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: maxTokens,
      system: system,
      messages: [{ role: 'user', content: userText }],
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + response.getResponseCode() + ': ' +
                    response.getContentText().slice(0, 800));
  }

  const data = JSON.parse(response.getContentText());
  return (data.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n');
}

/**
 * Pass 1 — research. Reads the email digest plus the full fetched
 * paper sources and produces structured per-paper notes the script
 * pass can lean on.
 */
function generateResearchNotes(subject, emailBody, papers) {
  const buildContext = CONFIG.PODCAST.buildContext || '';

  const system =
    'You are the senior research analyst for a daily AI research podcast ' +
    'made for an internal builder audience.\n\n' +
    (buildContext ? 'CONTEXT — what "we" are building:\n' + buildContext + '\n\n' : '') +
    'You read the day\'s digest plus the underlying source papers, then write ' +
    'tight, opinionated notes that the writers will turn into a script. The ' +
    'notes should treat each paper not as abstract news, but as something that ' +
    'might affect the PYRANA/Cortex roadmap — so the "Connection" and "Builder ' +
    'takeaway" lines should be concrete about what it means for our work, not ' +
    'generic industry commentary.\n\n' +
    'For each paper worth covering, output a block in this exact format:\n\n' +
    '=== PAPER ===\n' +
    'Title: <paper title>\n' +
    'Authors: <first author et al, or short list>\n' +
    'Source depth: <full-text | abstract-only | digest-only> ' +
    '(say honestly what you had access to)\n' +
    'Why it matters: <2-3 sentences. The actual reason a PYRANA/Cortex builder ' +
    'should care today.>\n' +
    'Core claim: <one sentence. The specific result, with numbers if available.>\n' +
    'Mechanism: <3-5 sentences. How it works under the hood. Be concrete: ' +
    'what\'s the architecture, the loss, the data, the trick. Avoid hand-waving. ' +
    'If you only have the abstract, say "abstract only — mechanism details ' +
    'absent" rather than inventing.>\n' +
    'Numbers that matter: <bullet list of 2-5 specific results: benchmarks, ' +
    'parameter counts, throughput, costs. Include units. Skip if there are none.>\n' +
    'Steel-manned objection: <the strongest critique a smart skeptic would raise. ' +
    'Not a strawman. Examples: dataset contamination, narrow benchmark, ' +
    'compute requirements that won\'t hold at scale, mismatch with prior work.>\n' +
    'Connection to PYRANA/Cortex: <one or two sentences. Where does this touch ' +
    'what we\'re building — CxU extraction, agent retrieval, governance, the ' +
    'Cortex Context Engine itself, or the platform roadmap? If the digest email ' +
    'already framed PYRANA-relevance, lean into that framing here.>\n' +
    'Field connection: <one sentence linking to a recent paper, trend, or ' +
    'standing debate in the wider field. Name names where relevant.>\n' +
    'Builder takeaway: <one sentence. What should we do differently in PYRANA/' +
    'Cortex this quarter as a result of this paper?>\n' +
    '=== END ===\n\n' +
    'Rules:\n' +
    '  • Cover up to 4 papers. Pick the most substantive — skip filler.\n' +
    '  • If a "Numbers that matter" entry isn\'t in the source, do not invent one. ' +
    'Write "n/a" rather than guessing.\n' +
    '  • If source material is thin, set "Source depth" honestly and dial ' +
    'detail in "Mechanism" accordingly. The script pass needs to know what ' +
    'the hosts can confidently say vs. flag as a limit.\n' +
    '  • Do not include any preamble, headers, or commentary outside the blocks.';

  let user = 'Today\'s digest email:\n\n' +
             'Subject: ' + subject + '\n\n' +
             emailBody.slice(0, 8000) + '\n\n';

  if (papers && papers.length) {
    user += '─── Source papers (fetched) ───\n\n';
    for (let i = 0; i < papers.length; i++) {
      const p = papers[i];
      user += '[' + (i + 1) + '] ' + p.title + '\n' +
              p.url + '\n\n' +
              p.text + '\n\n';
    }
  } else {
    user += '(No source papers were fetched. Work from the digest only and ' +
            'be honest about the resulting depth limits.)\n\n';
  }

  user += 'Write the research notes now.';

  return callClaude(
    CONFIG.CLAUDE.researchModel,
    CONFIG.CLAUDE.researchMaxTokens,
    system,
    user
  );
}

/**
 * Pass 2 — script. Turns research notes into a two-host dialogue.
 * Targets CONFIG.CLAUDE.targetMinutes minutes (~150 wpm).
 */
function generatePodcastScript(subject, emailBody, papers) {
  Logger.log('  📚 ' + (papers ? papers.length : 0) + ' source paper(s) fetched');
  Logger.log('  🔬 Research pass...');
  const notes = generateResearchNotes(subject, emailBody, papers || []);
  Logger.log('  → ' + notes.length + ' chars of notes');

  Logger.log('  ✏️  Script pass...');
  const targetMinutes = CONFIG.CLAUDE.targetMinutes;
  const targetWords = targetMinutes * 150;
  const minWords = CONFIG.CLAUDE.minWords || Math.round(targetWords * 0.85);
  const buildContext = CONFIG.PODCAST.buildContext || '';

  const system =
    'You are head writer for "' + CONFIG.PODCAST.title + '", a daily AI research ' +
    'podcast made by the Zeroth Agents team for an internal builder audience.\n\n' +
    (buildContext ? 'CONTEXT — what "we" are building:\n' + buildContext + '\n\n' : '') +
    'Two hosts trade lines:\n' +
    '  HOST_A — warm, curious. Asks great questions. Occasionally summarizes ' +
    'for the listener and connects ideas across papers.\n' +
    '  HOST_B — deep technical chops. Sharp, specific opinions. Names mechanisms, ' +
    'cites numbers, draws comparisons to prior work. Will push back when ' +
    'something doesn\'t add up.\n\n' +
    'Both hosts are part of the PYRANA team. They speak in first-person plural ' +
    '("our Cortex agents," "what we\'re building," "how we handle CxUs today") ' +
    'when connecting papers back to the platform. This isn\'t outsider commentary ' +
    'on AI news — it\'s the team chewing through research that affects their ' +
    'own roadmap. Lean into the PYRANA-relevance framing that the daily digest ' +
    'email already provides; don\'t ignore it.\n\n' +
    'Source-depth honesty: each paper\'s research notes flag "Source depth" as ' +
    'full-text / abstract-only / digest-only. The hosts must respect this. ' +
    'When notes say abstract-only, the hosts should briefly acknowledge it on ' +
    'air ("we\'re working from the abstract on this one — would love the full ' +
    'method section") rather than narrate mechanism details they don\'t actually ' +
    'have. Honest beats bluffing.\n\n' +
    'Your job: turn the research notes below into a ' + targetMinutes +
    '-minute conversation (target ' + targetWords + ' words, MINIMUM ' + minWords +
    ' words — do not produce a shorter script). The notes are your source of ' +
    'truth — every claim in the script must be grounded in them.\n\n' +
    'LENGTH IS A HARD REQUIREMENT. If you are approaching the end of your ' +
    'planned structure and are still under ' + minWords + ' words, you have ' +
    'under-developed the papers. Go back into the notes and: walk through the ' +
    'mechanism in more concrete detail, dwell longer on the steel-manned ' +
    'objection, add a back-and-forth on what changes for builders, or surface ' +
    'a deeper comparison to prior work. Do NOT pad with filler ("yeah", ' +
    '"totally", recap loops) — add real substance from the notes.\n\n' +
    'Structure (rough budget for a ' + targetMinutes + '-min episode):\n' +
    '  1. Cold open (~45s, ~110 words): hook on the single most interesting ' +
    'result. Specific, not vague. "X went from 40% to 73% on benchmark Y" ' +
    'beats "big jump in performance."\n' +
    '  2. Walk through the papers, one at a time. Each paper deserves roughly ' +
    '3 minutes (~450 words) of dialogue covering:\n' +
    '       • The actual claim, with numbers\n' +
    '       • Mechanism walk-through — explain HOW it works, not just label it. ' +
    'Two or three back-and-forth turns minimum on the mechanism alone.\n' +
    '       • The steel-manned objection. HOST_B voices it; HOST_A pushes ' +
    'back or concedes. Real disagreement is fine and welcome.\n' +
    '       • Why a builder should care this quarter — concrete, not generic.\n' +
    '  3. PYRANA/Cortex implications segment (~120s, ~300 words): what does ' +
    'today\'s batch mean for what *we* are building? Cite the "Connection to ' +
    'PYRANA/Cortex" and "Builder takeaway" lines from the notes. Specific is ' +
    'better than vague — name the part of the platform (CxU extraction, agent ' +
    'retrieval, Cortex governance, etc.) and what should change as a result. ' +
    'This is where the episode earns its place vs just reading the digest.\n' +
    '  4. Field connections segment (~60s, ~150 words): what wider trend is ' +
    'forming across these papers? Name related external work explicitly.\n' +
    '  5. Sign-off (~20s): one or two sentences teasing what to watch for ' +
    'tomorrow.\n\n' +
    'Voice and texture:\n' +
    '  • Two friends who happen to know a lot. Hard Fork meets Latent Space.\n' +
    '  • Use specific numbers, model names, benchmark names. Drop the abstraction.\n' +
    '  • Natural disfluencies are good: "wait, back up — you\'re saying...", ' +
    '"hm, that\'s the part I don\'t buy", "yeah, exactly."\n' +
    '  • Short interjections are allowed (and good). It does not have to be strict ' +
    'A-B-A-B alternation. A one-word "right" or "wait" line from the other host ' +
    'reads as natural.\n' +
    '  • Light humor. No forced jokes. No corporate energy.\n' +
    '  • If the notes say "n/a" or flag thin source material, the hosts should ' +
    'say so honestly ("we only have the abstract on this one") rather than bluff.\n\n' +
    'CRITICAL FORMAT RULES:\n' +
    '  • Output ONLY alternating dialogue lines, nothing else.\n' +
    '  • Every line starts with exactly "HOST_A: " or "HOST_B: ".\n' +
    '  • No stage directions, no [music], no markdown, no preamble, no ending notes.\n' +
    '  • No paper titles in italics or quotes — just say them naturally.\n' +
    '  • Pronounceable: spell out unfamiliar acronyms first time ("MoE — mixture ' +
    'of experts").\n' +
    '  • No URLs, no "see the link in the show notes", no doc references — the ' +
    'listener cannot click anything.\n' +
    '  • Do not invent results, names, or numbers that aren\'t in the notes.';

  const user =
    '── Research notes ──\n\n' +
    notes + '\n\n' +
    '── Today\'s digest subject ──\n' +
    subject + '\n\n' +
    'Write the script now. HOST_A starts.';

  const raw = callClaude(
    CONFIG.CLAUDE.scriptModel,
    CONFIG.CLAUDE.scriptMaxTokens,
    system,
    user
  );

  return { turns: parseScript(raw), notes: notes };
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
    throw new Error('Could not parse any HOST_A/HOST_B turns from script. Raw output:\n' +
                    rawScript.slice(0, 1500));
  }
  return turns;
}

function cleanLine(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}
