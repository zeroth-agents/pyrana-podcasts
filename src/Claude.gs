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
    '  HOST_A — warm, curious. Asks great questions on behalf of the listener. ' +
    'Frequently summarizes, asks for plain-English re-explanations, and connects ' +
    'ideas across papers. When HOST_B uses jargon, HOST_A is the one who says ' +
    '"wait, back up — what does that actually mean?"\n' +
    '  HOST_B — deep technical knowledge but explains everything like a great ' +
    'teacher. Sharp, specific opinions. Names mechanisms and cites numbers, but ' +
    'always grounds them in plain English and analogies before getting deep. ' +
    'Will push back when something doesn\'t add up.\n\n' +
    'ACCESSIBILITY — read this carefully.\n' +
    'These episodes were getting too technical too quickly. The audience is ' +
    'smart but not specialists in every AI subfield. Rules:\n' +
    '  • Assume high-school level baseline. If you use a term beyond that ' +
    '(MoE, RLHF, MLA, RAG, KV-cache, distillation, LoRA, FlashAttention, ' +
    'mixture-of-experts, etc.), explain it in one sentence the FIRST time it ' +
    'appears in the episode. Best pattern: HOST_A asks for the plain version, ' +
    'HOST_B gives it.\n' +
    '  • Lead with the human-readable "what does this mean" BEFORE the mechanism. ' +
    '"This paper makes models 3x cheaper to run by changing how they remember ' +
    'context across long conversations" → THEN you can get into how it works.\n' +
    '  • Analogies welcome. "Think of it like a librarian who keeps a small ' +
    'cache of frequently-asked questions instead of re-reading the shelves every ' +
    'time" beats "they use a learned key-value approximation."\n' +
    '  • Don\'t gatekeep. Builder context is good; jargon density is not.\n\n' +
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
    '  1. EXTENDED COLD OPEN (~90-120s, ~250 words). Two beats:\n' +
    '       (a) The day\'s theme — what links the papers in this batch, in ' +
    'one human sentence. "Today is mostly about making retrieval cheaper" or ' +
    '"Three papers on getting agents to plan further ahead."\n' +
    '       (b) Why we care for PYRANA/Cortex — concrete, not vague. "Two of ' +
    'these directly affect how we should be storing CxUs" or "The middle paper ' +
    'is the thing we\'ve been waiting for to make our retrieval pipeline 3x ' +
    'cheaper." Name the part of the platform.\n' +
    '       Then set up what\'s coming — "we\'ll walk through them, then come ' +
    'back to what we should actually do about it." DO NOT dive into mechanism ' +
    'in the cold open. Stay readable.\n' +
    '  2. Walk through the papers, one at a time. Each paper deserves roughly ' +
    '3 minutes (~450 words). For each paper, IN THIS ORDER:\n' +
    '       (a) Plain-English summary first (~60s): "This paper shows X by ' +
    'doing Y, and the headline result is Z." No jargon yet. The listener ' +
    'should understand what the paper is even if they tune out the next part.\n' +
    '       (b) Mechanism walk-through (~90s): NOW you can get into how it ' +
    'works. Two or three back-and-forth turns. HOST_A asks "explain that like ' +
    'I\'m new to this" if HOST_B uses a term that hasn\'t been unpacked yet. ' +
    'Lean on analogies.\n' +
    '       (c) Steel-manned objection (~30s): HOST_B raises it; HOST_A pushes ' +
    'back or concedes. Honest disagreement welcome.\n' +
    '       (d) Builder takeaway (~30s): What does this change for PYRANA/' +
    'Cortex this quarter — concrete, not generic.\n' +
    '  3. PYRANA/Cortex implications segment (~90s, ~225 words): pull the ' +
    'threads together. Cite the "Connection to PYRANA/Cortex" lines from the ' +
    'notes. Name the part of the platform — CxU extraction, agent retrieval, ' +
    'Cortex governance, etc. — and what should change. This is where the ' +
    'episode earns its place vs. just reading the digest.\n' +
    '  4. Field connections segment (~45s, ~110 words): wider trend forming ' +
    'across these papers. Name related external work explicitly.\n' +
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

/**
 * Pass 3 — show notes. Short HTML for the RSS <description> field
 * (also persisted alongside the transcript). Spotify/Apple render basic
 * HTML in show notes; we keep tags simple: p, ul, li, a, strong.
 *
 * Inputs:
 *   subject     — email subject (becomes episode title)
 *   scriptTurns — parsed dialogue, for episode summary
 *   papers      — [{url, title, text}] from fetchAllPapers; URLs link out
 */
function generateShowNotes(subject, scriptTurns, papers) {
  Logger.log('  📝 Show-notes pass...');
  const buildContext = CONFIG.PODCAST.buildContext || '';

  // Compact transcript for the prompt — first ~3000 chars is plenty to
  // capture the cold open and a paper or two; summary doesn't need the
  // whole script.
  const scriptText = scriptTurns
    .map(function (t) { return 'HOST_' + t.speaker + ': ' + t.text; })
    .join('\n')
    .slice(0, 6000);

  const papersBlock = (papers && papers.length)
    ? papers.map(function (p, i) {
        return '[' + (i + 1) + '] ' + p.title + '\n    ' + p.url;
      }).join('\n')
    : '(no papers fetched)';

  const system =
    'You write the show notes for "' + CONFIG.PODCAST.title + '", a daily AI ' +
    'research podcast.\n\n' +
    (buildContext ? 'CONTEXT — what "we" build:\n' + buildContext + '\n\n' : '') +
    'Your job: produce concise HTML show notes for this episode. Output ' +
    'PLAIN HTML — no markdown, no preamble, no closing remarks, no <html>/' +
    '<body> tags. Only these elements are allowed: <p>, <strong>, <em>, ' +
    '<a href="...">, <ul>, <li>.\n\n' +
    'Required structure, in this order:\n' +
    '  1. Two short paragraphs (<p>...</p>). First paragraph: the episode\'s ' +
    'theme in plain English — what the papers have in common, what the ' +
    'listener will learn. Second paragraph: why it matters for PYRANA/Cortex ' +
    'specifically. Concrete, not vague.\n' +
    '  2. <p><strong>Papers covered:</strong></p> followed by a <ul> with one ' +
    '<li> per paper. Each list item: <a href="URL">Paper title</a> — one-line ' +
    'plain-English summary (max ~20 words). Only include papers that were ' +
    'actually discussed in the script — if a fetched paper wasn\'t covered, ' +
    'leave it out.\n' +
    '  3. <p><strong>Takeaways for our platform:</strong></p> followed by a ' +
    '<ul> with 2-3 <li> bullets. Each bullet: a specific implication for ' +
    'PYRANA, Cortex, CxU extraction, agent retrieval, or governance. Concrete ' +
    'ideally with a verb ("Audit our CxU chunking against the X result," ' +
    '"Consider Y for our next retrieval iteration"). Generic platitudes are ' +
    'banned.\n\n' +
    'Total length target: 250-400 words. Under 2500 characters total. ' +
    'No emojis. No "in this episode" filler. Start directly with the first <p>.';

  const user =
    '── Episode subject ──\n' + subject + '\n\n' +
    '── Papers available (with URLs) ──\n' + papersBlock + '\n\n' +
    '── Script excerpt ──\n' + scriptText + '\n\n' +
    'Write the show-notes HTML now.';

  const raw = callClaude(
    CONFIG.CLAUDE.researchModel,    // Sonnet is plenty for this
    1500,
    system,
    user
  );

  return cleanShowNotesHtml(raw);
}

/**
 * Strip stray code fences and the kind of preamble Claude sometimes
 * adds despite instruction. Keep only the HTML body.
 */
function cleanShowNotesHtml(raw) {
  let s = raw.trim();
  // Strip leading code-fence markers.
  s = s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '');
  // If the model leads with prose before the first tag, drop everything
  // before the first <p>.
  const firstTag = s.indexOf('<p');
  if (firstTag > 0) s = s.slice(firstTag);
  return s.trim();
}
