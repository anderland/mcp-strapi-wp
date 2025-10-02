import { ChatOpenAI } from '@langchain/openai';
import { RunnableSequence, RunnableMap } from '@langchain/core/runnables';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? 0.35);
const ENV_STAGE = process.env.RULESET_STAGE;
const ENV_RULESET_PATH = process.env.RULESET_PATH;
// Feature flag: default OFF — when false, SUS gate drops flagged sentences
const SUS_SALVAGE = /^(1|true|yes)$/i.test(process.env.SUS_SALVAGE || 'false');

function truthyEnv(name, def = 'false') {
  return /^(1|true|yes)$/i.test(process.env[name] || def);
}

function stableHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function loadTextFileMaybe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function resolveRulesetPath() {
  if (ENV_RULESET_PATH && fs.existsSync(ENV_RULESET_PATH))
    return ENV_RULESET_PATH;

  const candidates = [path.resolve(process.cwd(), 'data/ruleset.json')];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'Unable to locate ruleset JSON. Set RULESET_PATH or place ruleset.json under ./data/.'
  );
}

function loadRulesetFromFile() {
  try {
    const rulesetPath = resolveRulesetPath();
    const raw = loadTextFileMaybe(rulesetPath);
    if (!raw) throw new Error(`Failed to read ruleset at: ${rulesetPath}`);
    const json = JSON.parse(raw);
    const sha = stableHash(raw);
    return { ruleset: json, sha, path: rulesetPath };
  } catch (e) {
    // Fallback to an empty ruleset if none is provided
    return { ruleset: [], sha: 'empty', path: '(none)' };
  }
}

function coerceStage(inputStage) {
  const val = inputStage ?? (ENV_STAGE !== undefined ? Number(ENV_STAGE) : 0);
  const n = Number.isFinite(val)
    ? Math.max(0, Math.min(7, Math.trunc(val)))
    : 0;
  return n;
}

// BASE prompt: newsroom role, AP-style enforcement, anti-hallucination, JSON-only.
const BASE_PROMPT = [
  'ROLE: You are a senior newsroom copy editor responsible for consistency, clarity, and high editorial standards.',
  'AUTHORITATIVE CONTEXT: A RULESET (array of rules) is provided for style and quality decisions.',
  'OBJECTIVES:',
  '- Detect and explain issues against the RULESET (analysis.findings).',
  '- Produce a rewrite that adheres to the RULESET and journalism principles, improving clarity, concision, and consistency.',
  '- Use a news voice: concise, specific, active, third-person; avoid sensational or loaded language.',
  'CORE PRINCIPLES:',
  '- Accuracy and fairness; avoid speculation; preserve meaning.',
  '- Attribution for non-obvious claims; avoid plagiarism; respect context.',
  '- Accountability and harm minimization; avoid stereotypes and undue emphasis.',
  'NEWS DISCOURSE HINT (van Dijk schema, implicit):',
  '- Lead with who/what/when/where/why/how; follow with main event, background, consequences/next steps, reactions/attribution.',
  '- Do not label sections; reflect this structure in the flow.',
  'REWRITE SHAPE:',
  '- When appropriate, reshape into a brief: a short lede and compact follow-up paragraphs in inverted pyramid order.',
  '- Enforce style per RULESET (capitalization, numbers, dates/times, punctuation).',
  '- Keep names/facts from TEXT; do not add information not present in TEXT.',
  '- SUBJECT CLARITY: Prefer specific subjects over generic ones. Use the city name (e.g., "Detroit") instead of "the city" when the location is clear. Use "Officials" or "City officials" instead of "the city" for governmental actions.',
  'ANTI-HALLUCINATION (MANDATORY): You MUST NOT invent or infer facts, names, numbers, dates, places, quotes, or sources. Use only TEXT or explicit RULESET info. If unspecified, omit it. Never guess or add new content.',
  'INPUT: TEXT (string), RULESET (array).',
  'OUTPUT (JSON only): {',
  '  "version":"mcp-demo/0.3",',
  '  "analysis": { "findings":[{',
  '    "rule_id","title","level","severity","confidence",',
  '    "evidence_snippet","cues_matched","guard_hits"',
  '  }], "tone":{"polarity","confidence"} },',
  '  "rewrite": { "text", "rationale":[string], "ops":[{ "rule_id","before","after"}] }',
  '}',
  'SCORING: base 0.6, +0.1 per extra cue beyond first; -0.2 if any guards hit.',
  'CONSTRAINTS:',
  '- Evidence snippets <= 40 chars.',
  '- Hedging terms ("reportedly," "allegedly," etc.) do NOT permit retaining any content that a higher-stage rule excludes.',
  '- Decisions must be derived from TEXT-only cues; do not use outside knowledge to judge plausibility, authority, or fictionality. If TEXT does not establish it, treat it as absent.',
  '- Do not echo RULESET or add commentary; return JSON only.',
];

// Progressive chunks (0..6). Each stage includes all prior chunks *except* where later stages explicitly override.

const CHUNKS = [
  // Stage 0 — Baseline: keep extraordinary claims as claims (moved out of lede).
  {
    id: 0,
    title: 'Baseline extraordinary-claim handling (keep-as-claim)',
    text: [
      'UNATTRIBUTED EXTRAORDINARY CLAIMS (BASELINE):',
      '- If a claim is extraordinary/improbable and lacks attribution in TEXT, do not assert it as fact.',
      '- In the rewrite, keep it as a claim—either quote it or prefix with "Reportedly, …". If a specific source is named, prefer "According to [SOURCE], …". Move it out of the lede.',
      '- Add a high-severity finding requiring attribution.',
      'REWRITE SIZE: Target ~120–200 words unless more is required to preserve meaning.',
    ].join('\n'),
  },

  // Stage 1 — Topic & Relevance Gate (soft)
  {
    id: 1,
    title: 'Topic & Relevance Gate (soft)',
    text: [
      'TOPIC FOCUS (GUIDANCE): First, infer the primary event/topic from TEXT by salience and repetition.',
      'RELEVANCE RULE: Keep only sentences that directly describe that event or add necessary who/what/when/where/why/how or logistics.',
      'CATASTROPHE IRRELEVANCE (SOFT): If a sentence describes a separate catastrophic event that would negate the logistics of the primary event (e.g., “city burned down” vs. “city opens services”), move it out of the lede and log a finding; final include/exclude is handled at Stage 2.',
      'Omit sentences that are off-topic or non-supporting and would force external context. Do not replace them with speculation.',
    ].join('\n'),
  },

  // Stage 2 — Extraordinary Claim = Exclude (hard) (OVERRIDES stage 0)
  {
    id: 2,
    title: 'Extraordinary Claim = Exclude (hard)',
    text: [
      'OVERRIDE — EXTRAORDINARY CLAIMS WITHOUT IN-TEXT CORROBORATION (MANDATORY):',
      '- If a claim is extraordinary/improbable and either (a) lacks attribution, or (b) has only single-source attribution with NO corroboration elsewhere in TEXT, exclude it from rewrite.text entirely.',
      '- Hedging (e.g., “reportedly,” “allegedly”) does not override this rule; do not retain, paraphrase, or relocate the claim.',
      '— Authority & Jurisdiction (TEXT-only): treat a source as non-authoritative if TEXT does not explicitly establish a role/title with decision-making or official visibility over the affected location/topic. Off-jurisdiction roles do not count as corroboration.',
      '— Fictionality/Novelty heuristic (TEXT-only): if TEXT provides no institutional affiliation or recognizable role and the name appears only once with playful or non-institutional markers (e.g., nickname-like tokens), treat as non-authoritative.',
      '— Corroboration test (TEXT-only): corroboration requires a second, independent sentence in TEXT that restates the event’s core predicate/scale or provides verifiable logistics directly dependent on it. Mere reactions, opinions, or vague restatements do not count.',
      '- Record excluded claims only in analysis.findings with high severity and a brief evidence_snippet.',
    ].join('\n'),
  },

  // Stage 3 — Internal Coherence Filter
  {
    id: 3,
    title: 'Internal Coherence Filter',
    text: [
      'COHERENCE CHECK (MANDATORY): Remove any sentence that creates contradictions in time, place, actors, or scale relative to the dominant topic.',
      'TEMPORAL LOGIC (CRITICAL): Carefully examine ALL time references. Events cannot happen "after" something that occurs later in time.',
      'SPECIFIC CHECKS:',
      '- If something is "announced at [TIME1] after [EVENT] that ran/ended at [TIME2]", verify TIME1 comes after TIME2',
      '- Convert times to 24-hour format for comparison: noon = 12:00, 2 p.m. = 14:00',
      '- "from X to Y" means the event ends at Y, so anything "after" must be later than Y',
      'EXAMPLE TEMPORAL VIOLATIONS:',
      '- "announced at noon after a briefing that ran from 10 a.m. to 2 p.m." → IMPOSSIBLE (noon/12:00 < 2 p.m./14:00)',
      '- "announced at noon after a briefing that ended at 2 p.m." → IMPOSSIBLE (noon is before 2 p.m.)',
      '- "arrived at 9 a.m. following the 10 a.m. meeting" → IMPOSSIBLE sequence',
      'When detecting temporal violations, use rule_id: "temporal-coherence" with high severity (0.9+).',
      'ACTION: Either fix the temporal sequence in the rewrite OR exclude the sentence entirely and log the violation.',
      'If including a sentence would require unstated background or external knowledge to remain coherent, exclude it and log a finding.',
      'EXAMPLE SCALE VIOLATION: A sentence asserting total destruction of a location contradicts later sentences about operational continuity (e.g., "city burned down" vs. "city opens services") → exclude the destructive sentence and log a contradiction.',
    ].join('\n'),
  },

  // Stage 4 — Harm & Panic Minimization
  {
    id: 4,
    title: 'Harm & Panic Minimization',
    text: [
      'HARM MINIMIZATION (MANDATORY): Exclude panic-inducing catastrophe claims that lack source attribution and are not essential to the public-service information in TEXT.',
      'Log a high-severity finding requiring verification/attribution.',
      'Even if attributed, panic-inducing catastrophe claims without corroboration in TEXT and not essential to actionable public-service information must be excluded (and logged).',
    ].join('\n'),
  },

  // Stage 5 — Quote & Nickname Discipline
  {
    id: 5,
    title: 'Quote & Nickname Discipline',
    text: [
      'QUOTE DISCIPLINE (GUIDANCE): Retain quotes only if they provide substantive facts or logistics about the primary event.',
      'Omit nicknames, slogans, novelty labels, and attention-bait that do not add factual content.',
    ].join('\n'),
  },

  // Stage 6 — External Sanity Cross-Check (SUS agent; advisory, world-knowledge allowed)
  {
    id: 6,
    title:
      'External Sanity Cross-Check (SUS agent, world-knowledge; no invention)',
    text: [
      'SUSPECT-NESS CHECK (ADVISORY, WORLD-KNOWLEDGE ALLOWED): A second agent evaluates TEXT for obvious red flags using common knowledge (fictional entities, category errors, impossible scales).',
      'HARD GUARANTEES:',
      '- Never introduce new facts, names, quotes, numbers, or specifics into rewrite.text.',
      '- Output only flags and brief reasons; do not expand content.',
      'OUTPUT (JSON from SUS agent): { "version":"sus/v1", "flags":[{ "term","category","level":"none|low|medium|high","reason"}], "block_terms":[string], "rationale":[string] }',
      'GUIDELINES:',
      '- Fictional or non-geographic entities presented as authorities → flag (e.g., fantasy locations/characters).',
      '- Off-jurisdiction authority claims where the role cannot logically govern the affected location → flag.',
      '- Impossible or maximal-scale claims that contradict observed logistics → flag.',
      'NOTE: Stage 6 produces advisory flags only; Stage 7 enforces gating based on these flags.',
    ].join('\n'),
  },

  // Stage 7 — Selection-Only Constraint & SUS Gate (assemble from safe phrases only)
  {
    id: 7,
    title: 'Selection-Only Constraint & SUS Gate',
    text: [
      'SELECTION-ONLY REWRITE (MANDATORY): rewrite.text must be formed solely by selecting, lightly editing for style/clarity, and re-ordering information already present in TEXT.',
      'You may omit sentences per these rules; you may not invent new facts, entities, numbers, places, or quotes.',
      'SUS GATE (MANDATORY at Stage 7): Before issuing rewrite.text, remove any sentence that contains a term flagged by the SUS agent at level ≥ medium, unless there is explicit in-TEXT corroboration per Stage 2. Log a finding and note removed terms in analysis.',
    ].join('\n'),
  },
];

export function makeRulesetSystemPrompt(stage = 0) {
  const s = coerceStage(stage);
  const parts = [...BASE_PROMPT];

  for (let i = 0; i <= s; i++) {
    const ch = CHUNKS[i];
    if (ch) parts.push(`\n### STAGE ${i}: ${ch.title}\n${ch.text}`);
  }

  if (s >= 5) {
    parts.push(
      [
        'AT STAGES ≥5 — EXTRACT VERBATIM SPANS & PREPARE A LEDE CANDIDATE (TEXT-ONLY):',
        '- Provide a "spans" object with arrays of verbatim substrings from TEXT:',
        '  spans = { subjects:[], actions:[], where:[], when:[], context:[], numbers:[] }',
        '- Build "lede_candidate" as ONE sentence assembled ONLY from items in spans and a tiny ALLOWED_GLUE vocabulary:',
        '  ALLOWED_GLUE = ["will","to","by","as","after","from","at","and","for","over","during","amid","because","that","on","in","of","the","a","an",",",".","officials"]',
        '- SUBJECT SELECTION PRIORITY (TEXT-CONSTRAINED):',
        '  (1) If a specific city/location is mentioned (e.g., "Detroit"), prefer it as the subject',
        '  (2) person+role tied to the action (only if not flagged as fictional)',
        '  (3) named office/agency',
        '  (4) "Officials" or "City officials" when the actor is unclear but action is governmental',
        '  (5) generic "the city" only as absolute last resort',
        '- LEDE SHAPE: [subject] [action] [where?] [when?] [context?]. No new facts/names/numbers. Do not exceed one sentence.',
        '- CRITICAL: Avoid starting sentences with "The city will" when a more specific subject is available.',
      ].join('\n')
    );
  }

  if (s >= 2) {
    parts.push(
      'NOTE: Where any guidance conflicts, higher-stage rules override lower-stage rules.'
    );
  }

  return parts.join('\n');
}

function makeSusAgentPrompt() {
  return [
    'ROLE: You are a world-knowledge sanity checker (SUS agent).',
    'OBJECTIVE: Identify red flags in TEXT that suggest fictionality, authority/jurisdiction mismatch, or impossible claims.',
    'HARD RULES:',
    '- DO NOT invent or assert new facts, names, numbers, dates, or quotes.',
    '- You may use common world knowledge only to assign a suspicion level and name suspicious terms.',
    'INPUT: TEXT (string).',
    'OUTPUT (JSON only): {',
    '  "version":"sus/v1",',
    '  "flags":[{ "term":string, "category":string, "level":"none"|"low"|"medium"|"high", "reason":string }],',
    '  "block_terms":[string],',
    '  "rationale":[string]',
    '}',
    'CATEGORIES: ["fictionality","jurisdiction","impossible-scale","nonsense","other"]',
    'POLICY: Prefer precision. If unsure, use "low".',
  ].join('\n');
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const COMMON_ABBR = [
  // Titles
  'Mr.',
  'Mrs.',
  'Ms.',
  'Dr.',
  'Prof.',
  'Gov.',
  'Sen.',
  'Rep.',
  'Maj.',
  'Col.',
  'Gen.',
  // Name suffixes
  'Jr.',
  'Sr.',
  'St.',
  // Months
  'Jan.',
  'Feb.',
  'Mar.',
  'Apr.',
  'Jun.',
  'Jul.',
  'Aug.',
  'Sep.',
  'Sept.',
  'Oct.',
  'Nov.',
  'Dec.',
  // Time
  'a.m.',
  'p.m.',
  // Other common
  'U.S.',
  'No.',
  'vs.',
  'etc.',
  'e.g.',
  'i.e.',
];

function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') return [];
  const SENTINEL = '\uE000';
  let tmp = text;
  for (const abbr of COMMON_ABBR) {
    const re = new RegExp('\\b' + escapeRegExp(abbr), 'g');
    tmp = tmp.replace(re, abbr.replace(/\./g, SENTINEL));
  }
  // Normalize punctuation noise
  tmp = tmp.replace(/\u2026/g, '...').replace(/\s+—\s+/g, ' — ');
  // Split on end punctuation possibly followed by quotes/brackets
  // e.g., '... said." Next' or '... said.) Next'
  const parts = tmp.split(/(?<=[.!?]["')\]\}]*)(?:\s+|\n+)/);
  return parts
    .map((p) => p.replace(new RegExp(SENTINEL, 'g'), '.').trim())
    .filter(Boolean);
}

function hasFiniteVerb(s) {
  // Expanded finite-verb heuristics
  return /\b(will|is|are|was|were|opens?|open|launch(?:es|ed)?|orders?|approv(?:e|es|ed)|votes?|plans?|aims?|uses?|deploys?|announced|said|stated|confirmed|reported)\b/i.test(
    s || ''
  );
}
function isWeakLead(s) {
  if (!s) return true;
  if (/^(the plan|there\s+(?:is|are)|it\s+(?:is|was))/i.test(s)) return true;
  return !hasFiniteVerb(s);
}

function ensureParseStructure(parsed, defaultText) {
  parsed.analysis = parsed.analysis || {
    findings: [],
    tone: { polarity: 'neutral', confidence: 0.5 },
  };
  parsed.analysis.findings = parsed.analysis.findings || [];
  parsed.rewrite = parsed.rewrite || {
    text: defaultText,
    rationale: [],
    ops: [],
  };
  parsed.rewrite.rationale = parsed.rewrite.rationale || [];
  parsed.rewrite.ops = parsed.rewrite.ops || [];
}

function collectFlaggedTerms(sus) {
  const terms = new Set();

  if (Array.isArray(sus.flags)) {
    sus.flags
      .filter(
        (f) =>
          (f.level === 'high' || f.level === 'medium') &&
          typeof f.term === 'string' &&
          f.term.trim()
      )
      .forEach((f) => terms.add(f.term.trim().toLowerCase()));
  }

  if (Array.isArray(sus.block_terms)) {
    sus.block_terms
      .filter((t) => typeof t === 'string' && t.trim())
      .forEach((t) => terms.add(t.trim().toLowerCase()));
  }

  return terms;
}

function makeTermRegex(term) {
  const safe = escapeRegExp(term.trim());
  return new RegExp(`\\b${safe.replace(/\\s+/g, '[\\s-]+')}\\b`, 'i');
}

const llm = new ChatOpenAI({
  model: DEFAULT_MODEL,
  temperature: DEFAULT_TEMPERATURE,
});

export const rulesetPipeline = RunnableSequence.from([
  RunnableMap.from({
    TEXT: (i) => i.text,
    STAGE: (i) => coerceStage(i?.stage),
    RULESET_BUNDLE: () => loadRulesetFromFile(),
    systemPrompt: (i) => makeRulesetSystemPrompt(coerceStage(i?.stage)),
  }),

  async ({ TEXT, STAGE, RULESET_BUNDLE, systemPrompt }) => {
    const {
      ruleset: RULESET,
      sha: RULESET_SHA,
      path: RULESET_PATH,
    } = RULESET_BUNDLE;

    const userPayload = { TEXT, RULESET };
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify(
          {
            ...userPayload,
            _debug: { stage: STAGE, ruleset_path: RULESET_PATH },
          },
          null,
          2
        ),
      },
    ];

    // --- Run rewrite (always) and SUS (stage ≥6) in parallel for latency ---
    const rewritePromise = llm.invoke(messages, {
      response_format: { type: 'json_object' },
    });

    let susPromise = null;
    if (STAGE >= 6) {
      const susPrompt = makeSusAgentPrompt();
      const susMessages = [
        { role: 'system', content: susPrompt },
        { role: 'user', content: JSON.stringify({ TEXT }, null, 2) },
      ];
      susPromise = llm.invoke(susMessages, {
        response_format: { type: 'json_object' },
      });
    }

    let res;
    try {
      res = await rewritePromise;
    } catch (e) {
      // LLM call failed; produce a safe placeholder result
      res = {
        content: JSON.stringify(
          {
            version: 'mcp-demo/0.4',
            analysis: {
              findings: [],
              tone: { polarity: 'neutral', confidence: 0.5 },
            },
            rewrite: {
              text: '',
              rationale: ['fallback: llm error — blocked output'],
              ops: [],
            },
          },
          null,
          2
        ),
      };
    }

    let parsed;
    try {
      parsed =
        typeof res.content === 'string' ? JSON.parse(res.content) : res.content;
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      parsed = {
        version: 'mcp-demo/0.4',
        analysis: {
          findings: [],
          tone: { polarity: 'neutral', confidence: 0.5 },
        },
        rewrite: {
          text: '',
          rationale: ['fallback: invalid JSON from model — blocked output'],
          ops: [],
        },
      };
      parsed.human_review_recommended = {
        flag: true,
        severity: 'high',
        reason: 'Invalid JSON from rewrite agent',
        details: ['Output suppressed to avoid bypassing safety stages.'],
        recommendation: 'Retry generation or route to human review.',
      };
    }

    // Stage 6: run SUS agent (advisory) using world knowledge with no invention.
    let sus = null;
    if (STAGE >= 6) {
      try {
        const susRes = await susPromise;
        sus =
          typeof susRes.content === 'string'
            ? JSON.parse(susRes.content)
            : susRes.content;
      } catch {
        sus = {
          version: 'sus/v1',
          flags: [],
          block_terms: [],
          rationale: ['fallback: sus parse error'],
        };
      }
      if (!sus || typeof sus !== 'object') {
        sus = {
          version: 'sus/v1',
          flags: [],
          block_terms: [],
          rationale: ['fallback: sus invalid'],
        };
      }
    }

    // Stage 7: apply SUS gate to rewrite.text
    // Logic kept intentionally simple: if SUS flags medium/high terms, drop those sentences.
    if (STAGE >= 7 && sus) {
      const flaggedTerms = collectFlaggedTerms(sus);
      if (flaggedTerms.size) {
        const original = parsed?.rewrite?.text ?? TEXT ?? '';
        const sentences = splitIntoSentences(original);
        const patterns = Array.from(flaggedTerms).map(makeTermRegex);
        const kept = [];
        const removed = [];
        for (const s of sentences) {
          const hit = patterns.some((re) => re.test(s));
          if (hit) {
            removed.push(s);
            if (!SUS_SALVAGE) {
              continue;
            }
            let redacted = s;
            for (const re of patterns) {
              redacted = redacted
                .replace(re, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
            }
            let salvage = redacted;
            const idxThat = salvage.toLowerCase().indexOf(' that ');
            if (idxThat > -1) {
              salvage = salvage.slice(idxThat + 6).trim();
            }
            salvage = salvage
              .replace(
                /^(announced|said|stated|noted|added|reported|confirmed|revealed)\s+that\s+/i,
                ''
              )
              .replace(
                /^(said|announced|stated|noted|added|reported|confirmed|revealed)\s+/i,
                ''
              )
              .trim();

            const startsWithModal =
              /^(will|would|shall|should|may|might|can|could|must|has|have|had|is|are|was|were)\b/i.test(
                salvage
              );
            const lacksSubject =
              startsWithModal ||
              /^(the\s+)?\b(plan|proposal|initiative|program|project)\b/i.test(
                salvage
              );

            if (lacksSubject) {
              continue;
            }

            const hasVerb =
              /\b(will|is|are|was|were|opens?|open|launch(?:es|ed)?|orders?|approv(?:e|es|ed)|votes?|plans?|aims?|uses?|deploys?)\b/i.test(
                salvage
              );
            const wordCount = salvage.split(/\s+/).filter(Boolean).length;
            if (hasVerb && wordCount >= 5) {
              if (!/[.!?]$/.test(salvage)) salvage += '.';
              salvage = salvage.charAt(0).toUpperCase() + salvage.slice(1);
              kept.push(salvage);
            }
            // If salvage fails, drop the sentence.
          } else {
            kept.push(s);
          }
        }
        const filtered = kept.join(' ').trim();
        if (filtered && filtered !== original) {
          ensureParseStructure(parsed, TEXT);
          parsed.rewrite.ops.push({
            rule_id: 'sus-gate',
            before: original,
            after: filtered,
          });
          parsed.rewrite.rationale.push(
            `Stage 7 SUS gate: removed ${
              removed.length
            } sentence(s) containing SUS-flagged terms${
              SUS_SALVAGE ? ' (with salvage enabled).' : '.'
            }`
          );
          parsed.analysis.findings.push({
            rule_id: 'sus-gate',
            title: 'SUS gate removal',
            level: 'hard',
            severity: 0.9,
            confidence: 0.7,
            evidence_snippet: Array.from(flaggedTerms).slice(0, 2).join(', '),
            cues_matched: ['sus-agent'],
            guard_hits: [],
          });
          parsed.rewrite.text = filtered;
        }
      }
    }

    // Stage 7: lead fallback using model-prepared lede_candidate (text-only, selection-based)
    if (STAGE >= 7) {
      const candidate =
        typeof parsed?.lede_candidate === 'string'
          ? parsed.lede_candidate.trim()
          : '';
      const current = parsed?.rewrite?.text ?? TEXT ?? '';
      if (candidate && current) {
        const sentences = splitIntoSentences(current);
        if (sentences.length) {
          const lead = sentences[0];
          if (isWeakLead(lead)) {
            const susTerms = sus ? collectFlaggedTerms(sus) : new Set();
            const patterns = Array.from(susTerms).map(
              (t) => new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i')
            );
            const candidateIsClean = patterns.length
              ? !patterns.some((re) => re.test(candidate))
              : true;
            if (candidateIsClean && hasFiniteVerb(candidate)) {
              const replaced = [candidate, ...sentences.slice(1)].join(' ');
              if (replaced !== current) {
                ensureParseStructure(parsed, current);
                parsed.rewrite.ops.push({
                  rule_id: 'lede-fallback',
                  before: current,
                  after: replaced,
                });
                parsed.rewrite.rationale.push(
                  'Stage 7 lede fallback: replaced weak/fragmentary first sentence with lede_candidate assembled from verbatim spans.'
                );
                parsed.analysis.findings.push({
                  rule_id: 'lede-fallback',
                  title: 'Lead improved with text-only lede candidate',
                  level: 'soft',
                  severity: 0.3,
                  confidence: 0.8,
                  evidence_snippet:
                    candidate.length > 40
                      ? candidate.slice(0, 40) + '…'
                      : candidate,
                  cues_matched: ['lede-candidate'],
                  guard_hits: [],
                });
                parsed.rewrite.text = replaced;
              }
            }
          }
        }
      }
    }

    parsed.catalog_version = RULESET_SHA;
    parsed._workshop = {
      stage: STAGE,
      stage_titles: CHUNKS.slice(0, STAGE + 1).map((c) => c.title),
      model: DEFAULT_MODEL,
      sus_salvage: SUS_SALVAGE,
    };
    if (sus) parsed._workshop.sus = sus;

    // Human review logic
    if (STAGE >= 3 && parsed.analysis && parsed.analysis.findings) {
      const findings = parsed.analysis.findings;

      // Count serious issues
      const highSeverityCount = findings.filter(
        (f) => f.severity >= 0.8
      ).length;
      const susGateHits = findings.filter(
        (f) => f.rule_id === 'sus-gate'
      ).length;
      const temporalViolations = findings.filter(
        (f) =>
          f.rule_id === 'temporal-coherence' ||
          (f.evidence_snippet &&
            f.evidence_snippet.toLowerCase().includes('after') &&
            f.title &&
            f.title.toLowerCase().includes('coher'))
      ).length;
      const extraordinaryClaims = findings.filter(
        (f) => f.rule_id && f.rule_id.includes('extraordinary')
      ).length;

      // Calculate sus score
      const suspicionScore =
        highSeverityCount * 2 +
        susGateHits * 3 +
        temporalViolations * 2 +
        extraordinaryClaims * 2;

      if (suspicionScore >= 5 || (susGateHits > 0 && highSeverityCount > 2)) {
        parsed.human_review_recommended = {
          flag: true,
          severity: suspicionScore >= 8 ? 'critical' : 'high',
          reason: 'Multiple credibility issues detected',
          details: [
            susGateHits > 0 && `${susGateHits} impossible element(s)`,
            temporalViolations > 0 &&
              `${temporalViolations} temporal inconsistency(ies)`,
            extraordinaryClaims > 0 &&
              `${extraordinaryClaims} extraordinary claim(s)`,
            highSeverityCount > 3 &&
              `${highSeverityCount} high-severity issues`,
          ].filter(Boolean),
          recommendation: 'Contains multiple red flags.',
        };
      }
    }

    return parsed;
  },
]);

export const RULESET_STAGES = CHUNKS.map((c) => ({ id: c.id, title: c.title }));
