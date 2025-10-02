import { rulesetPipeline } from '@/app/lib/ruleset-pipeline.js';
import { fetchVerification } from '@/mcp/clients.js';

// Modes:
// - off: disable fact-check entirely
// - preview: run a single query provided by client and attach results (non-blocking)
const MODE = process.env.FACTCHECK_MODE || 'off'; // "off" | "preview"

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal sentence splitter (keeps common abbreviations intact)
const COMMON_ABBR = [
  'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gov.', 'Sen.', 'Rep.', 'Maj.', 'Col.', 'Gen.',
  'Jr.', 'Sr.', 'St.',
  'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Sept.', 'Oct.', 'Nov.', 'Dec.',
  'a.m.', 'p.m.',
  'U.S.', 'No.', 'vs.', 'etc.', 'e.g.', 'i.e.'
];
function splitIntoSentences(text = '') {
  if (!text || typeof text !== 'string') return [];
  const SENTINEL = '\uE000';
  let tmp = text;
  for (const abbr of COMMON_ABBR) {
    const re = new RegExp('\\b' + escapeRegExp(abbr), 'g');
    tmp = tmp.replace(re, abbr.replace(/\./g, SENTINEL));
  }
  tmp = tmp.replace(/\u2026/g, '...').replace(/\s+—\s+/g, ' — ');
  const parts = tmp.split(/(?<=[.!?]["')\]\}]*)(?:\s+|\n+)/);
  return parts.map((p) => p.replace(new RegExp(SENTINEL, 'g'), '.').trim()).filter(Boolean);
}

function hasFiniteVerb(s = '') {
  return /\b(will|is|are|was|were|opens?|open|launch(?:es|ed)?|orders?|approv(?:e|es|ed)|votes?|plans?|aims?|uses?|deploys?|announced|said|stated|confirmed|reported)\b/i.test(
    s || ''
  );
}

export async function runWithVerification(mcpClient, input) {
  const { text, stage, factCheckQuery } = input || {};

  // 1) Run the pipeline with hardening (never throw)
  let result;
  try {
    result = await rulesetPipeline.invoke({ text, stage });
  } catch (e) {
    result = {
      version: 'mcp-demo/0.4',
      analysis: { findings: [], tone: { polarity: 'neutral', confidence: 0.5 } },
      rewrite: {
        text: '',
        rationale: [
          'fallback: pipeline error — blocked output',
          e && e.message ? `details: ${e.message}` : 'details: unknown error',
        ],
        ops: [],
      },
      _workshop: { stage: stage ?? 0, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' },
    };
  }

  if (!mcpClient || MODE === 'off') return result;

  // 2A) preview mode: single explicit query (and apply gating if disputed)
  if (MODE === 'preview' && factCheckQuery) {
    const fc = await fetchVerification(mcpClient, {
      query: factCheckQuery,
      languageCode: 'en',
      maxAgeDays: 365,
      pageSize: 3,
    });
    if (fc) {
      result._workshop = result._workshop || {};
      result._workshop.fact_check_tools = {
        query: fc.query,
        signals: fc.signals,
        results: fc.results,
      };

      // Surface soft evidence at Stage 6 when any reviews exist (advisory only)
      try {
        const sig = fc?.signals || {};
        const ratings = sig?.ratings || {};
        if (sig?.has_reviews && Number(stage ?? 0) >= 6) {
          result.analysis = result.analysis || { findings: [], tone: { polarity: 'neutral', confidence: 0.5 } };
          result.analysis.findings = result.analysis.findings || [];
          const summary = `support:${Number(ratings.support||0)} mixed:${Number(ratings.mixed||0)} dispute:${Number(ratings.dispute||0)}`;
          result.analysis.findings.push({
            rule_id: 'factcheck-evidence',
            title: 'External fact-check evidence available',
            level: 'soft',
            severity: 0.3,
            confidence: 0.6,
            evidence_snippet: summary,
            cues_matched: ['fact-check-tools'],
            guard_hits: [],
          });
        }
      } catch {}

      // If disputed by external reviews, gate at Stage 6+
      try {
        const sig = fc?.signals || {};
        const ratings = sig?.ratings || {};
        const disputed = !!sig?.has_reviews && Number(ratings.dispute || 0) > Number(ratings.support || 0);
        if (disputed && Number(stage ?? 0) >= 6 && result?.rewrite?.text) {
          const textBody = result.rewrite.text;
          const sentences = splitIntoSentences(textBody);
          const q = String(factCheckQuery || '').toLowerCase().trim();
          if (q) {
            const kept = [];
            const removed = [];
            for (const s of sentences) {
              const hit = s.toLowerCase().includes(q);
              if (hit) removed.push(s); else kept.push(s);
            }
            const filtered = kept.join(' ').trim();
            if (filtered && filtered !== textBody) {
              result.rewrite.ops = result.rewrite.ops || [];
              result.rewrite.rationale = result.rewrite.rationale || [];
              result.rewrite.ops.push({ rule_id: 'factcheck-gate', before: textBody, after: filtered });
              result.rewrite.rationale.push('Applied fact-check gate (preview): removed sentence(s) disputed by external reviews.');
              result.rewrite.text = filtered;

              // Add a finding
              result.analysis = result.analysis || { findings: [], tone: { polarity: 'neutral', confidence: 0.5 } };
              result.analysis.findings = result.analysis.findings || [];
              result.analysis.findings.push({
                rule_id: 'factcheck-dispute',
                title: 'Claim disputed by external fact-checks (preview)',
                level: 'hard',
                severity: 0.85,
                confidence: 0.6,
                evidence_snippet: q.slice(0, 80),
                cues_matched: ['fact-check-tools'],
                guard_hits: [],
              });
            }
          }
        }
      } catch {}
    }
    return result;
  }


  return result;
}
