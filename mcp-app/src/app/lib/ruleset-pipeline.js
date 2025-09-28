import { ChatOpenAI } from '@langchain/openai';
import { RunnableSequence, RunnableMap } from '@langchain/core/runnables';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? 0.35);
const ENV_STAGE = process.env.RULESET_STAGE;
const ENV_RULESET_PATH = process.env.RULESET_PATH;

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

  const candidates = [path.resolve(process.cwd(), 'data/ruleset_demo.json')];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'Unable to locate ruleset_demo.json. Set RULESET_PATH or place the file under ./data/ or /mnt/data/.'
  );
}

function loadRulesetFromFile() {
  const rulesetPath = resolveRulesetPath();
  const raw = loadTextFileMaybe(rulesetPath);
  if (!raw) throw new Error(`Failed to read ruleset at: ${rulesetPath}`);
  const json = JSON.parse(raw);
  const sha = stableHash(raw);
  return { ruleset: json, sha, path: rulesetPath };
}

function coerceStage(inputStage) {
  const val = inputStage ?? (ENV_STAGE !== undefined ? Number(ENV_STAGE) : 0);
  const n = Number.isFinite(val)
    ? Math.max(0, Math.min(6, Math.trunc(val)))
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
  'ANTI-HALLUCINATION (MANDATORY): You MUST NOT invent or infer facts, names, numbers, dates, places, quotes, or sources. Use only TEXT or explicit RULESET info. If unspecified, omit it. Never guess or add new content.',
  'INPUT: TEXT (string), RULESET (array).',
  'OUTPUT (JSON only): {',
  '  "version":"ap-demo/v2",',
  '  "analysis": { "findings":[{',
  '    "rule_id","title","level","severity","confidence",',
  '    "evidence_snippet","cues_matched","guard_hits"',
  '  }], "tone":{"polarity","confidence"} },',
  '  "rewrite": { "text", "rationale":[string], "ops":[{ "rule_id","before","after"}] }',
  '}',
  'SCORING: base 0.6, +0.1 per extra cue beyond first; -0.2 if any guards hit.',
  'CONSTRAINTS:',
  '- Evidence snippets <= 40 chars.',
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
      '- In the rewrite, keep it as a claim (quote it or prefix "The text says: …"), and move it out of the lede.',
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
      'Omit sentences that are off-topic or non-supporting and would force external context. Do not replace them with speculation.',
    ].join('\n'),
  },

  // Stage 2 — Extraordinary Claim = Exclude (hard) (OVERRIDES stage 0)
  {
    id: 2,
    title: 'Extraordinary Claim = Exclude (hard)',
    text: [
      'OVERRIDE — UNATTRIBUTED EXTRAORDINARY CLAIMS (MANDATORY):',
      '- If a claim is extraordinary/improbable and lacks attribution or corroboration in TEXT, do not include it in the rewrite at all.',
      '- Do not paraphrase, hedge, or relocate it. Exclude it from rewrite.text.',
      '- Record it only in analysis.findings with high severity and a brief evidence_snippet.',
    ].join('\n'),
  },

  // Stage 3 — Internal Coherence Filter
  {
    id: 3,
    title: 'Internal Coherence Filter',
    text: [
      'COHERENCE CHECK (MANDATORY): Remove any sentence that creates contradictions in time, place, actors, or scale relative to the dominant topic.',
      'If including a sentence would require unstated background or external knowledge to remain coherent, exclude it and log a finding.',
    ].join('\n'),
  },

  // Stage 4 — Harm & Panic Minimization
  {
    id: 4,
    title: 'Harm & Panic Minimization',
    text: [
      'HARM MINIMIZATION (MANDATORY): Exclude panic-inducing catastrophe claims that lack source attribution and are not essential to the public-service information in TEXT.',
      'Log a high-severity finding requiring verification/attribution.',
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

  // Stage 6 — Selection-Only Constraint (assemble from safe phrases only)
  {
    id: 6,
    title: 'Selection-Only Constraint',
    text: [
      'SELECTION-ONLY REWRITE (MANDATORY): rewrite.text must be formed solely by selecting, lightly editing for style/clarity, and re-ordering information already present in TEXT.',
      'You may omit sentences per these rules; you may not invent new facts, entities, numbers, places, or quotes.',
    ].join('\n'),
  },
];

export function makeRulesetSystemPrompt(stage = 0) {
  const s = coerceStage(stage);
  const parts = [...BASE_PROMPT];

  // Append chunks
  for (let i = 0; i <= s; i++) {
    const ch = CHUNKS[i];
    if (ch) parts.push(`\n### STAGE ${i}: ${ch.title}\n${ch.text}`);
  }

  if (s >= 2) {
    parts.push(
      'NOTE: Where any guidance conflicts, higher-stage rules override lower-stage rules.'
    );
  }

  return parts.join('\n');
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

    const res = await llm.invoke(messages, {
      response_format: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed =
        typeof res.content === 'string' ? JSON.parse(res.content) : res.content;
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      parsed = {
        version: 'ap-demo/v2',
        analysis: {
          findings: [],
          tone: { polarity: 'neutral', confidence: 0.5 },
        },
        rewrite: {
          text: TEXT,
          rationale: ['fallback: invalid JSON from model'],
          ops: [],
        },
      };
    }

    parsed.catalog_version = RULESET_SHA;
    parsed._workshop = {
      stage: STAGE,
      stage_titles: CHUNKS.slice(0, STAGE + 1).map((c) => c.title),
      model: DEFAULT_MODEL,
    };

    return parsed;
  },
]);

export const RULESET_STAGES = CHUNKS.map((c) => ({ id: c.id, title: c.title }));
