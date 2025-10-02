import { rulesetPipeline } from '@/app/lib/ruleset-pipeline.js';
import { fetchVerification } from '@/mcp/clients.js';

// Modes:
// - off: disable fact-check entirely
// - preview: run a single query provided by client and attach results (non-blocking)
// - auto: scan the whole text for claims and run multiple queries automatically (non-blocking by default)
const MODE = process.env.FACTCHECK_MODE || 'off'; // "off" | "preview" | "auto"
const MAX_CLAIMS = Number.parseInt(process.env.FACTCHECK_MAX_CLAIMS ?? '5');
const MIN_SENT_LEN = Number.parseInt(process.env.FACTCHECK_MIN_SENT_LEN ?? '40');
const MAX_SENT_LEN = Number.parseInt(process.env.FACTCHECK_MAX_SENT_LEN ?? '240');

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

async function runAutoFactCheck(mcpClient, baseText, stage, result) {
  try {
    if (!mcpClient) return result;

    const sentences = splitIntoSentences(baseText);
    const candidates = sentences
      .filter((s) => s.length >= MIN_SENT_LEN && s.length <= MAX_SENT_LEN && hasFiniteVerb(s))
      .slice(0, Math.max(1, MAX_CLAIMS));

    const checks = await Promise.all(
      candidates.map(async (q) => {
        const fc = await fetchVerification(mcpClient, {
          query: q,
          languageCode: 'en',
          maxAgeDays: 365,
          pageSize: 3,
        });
        return { query: q, fc };
      })
    );

    const items = checks.map((r) => ({
      query: r.query,
      signals: r.fc?.signals || { has_reviews: false },
      results: r.fc?.results || [],
    }));

    // Aggregate a simple rating bucket per claim
    function bucketCount(sig) {
      const c = sig?.ratings || {};
      return {
        support: Number(c.support || 0),
        mixed: Number(c.mixed || 0),
        dispute: Number(c.dispute || 0),
        clarification: Number(c.clarification || 0),
      };
    }

    const disputed = items.filter((it) => {
      const b = bucketCount(it.signals);
      return it.signals?.has_reviews && b.dispute > b.support && (b.dispute >= 1);
    });

    // Attach to workshop block
    result._workshop = result._workshop || {};
    result._workshop.fact_check_tools = {
      mode: 'auto',
      claims: items,
    };

    // Add analysis findings entries
    result.analysis = result.analysis || { findings: [], tone: { polarity: 'neutral', confidence: 0.5 } };
    result.analysis.findings = result.analysis.findings || [];
    for (const it of disputed.slice(0, 3)) {
      const snippet = (it.query || '').slice(0, 80);
      result.analysis.findings.push({
        rule_id: 'factcheck-dispute',
        title: 'Claim disputed by external fact-checks',
        level: 'hard',
        severity: 0.85,
        confidence: 0.6,
        evidence_snippet: snippet,
        cues_matched: ['fact-check-tools'],
        guard_hits: [],
      });
    }

    // Optional gating from Stage 6+: remove sentences strongly disputed by external fact-checks
    if (stage >= 6 && result?.rewrite?.text) {
      const text = result.rewrite.text;
      const allSentences = splitIntoSentences(text);
      const disputedQueries = new Set(disputed.map((d) => d.query.toLowerCase()));
      const kept = [];
      const removed = [];
      for (const s of allSentences) {
        const lower = s.toLowerCase();
        // Remove if sentence is identical or contains a disputed query substring (simple heuristic)
        const hit = Array.from(disputedQueries).some((q) => lower.includes(q.toLowerCase()));
        if (hit) removed.push(s); else kept.push(s);
      }
      const filtered = kept.join(' ').trim();
      if (filtered && filtered !== text) {
        result.rewrite.ops = result.rewrite.ops || [];
        result.rewrite.rationale = result.rewrite.rationale || [];
        result.rewrite.ops.push({ rule_id: 'factcheck-gate', before: text, after: filtered });
        result.rewrite.rationale.push('Applied fact-check gate: removed sentence(s) disputed by external reviews.');
        result.rewrite.text = filtered;
      }
    }

    return result;
  } catch (e) {
    // Non-fatal
    result._workshop = result._workshop || {};
    result._workshop.fact_check_tools = result._workshop.fact_check_tools || {};
    result._workshop.fact_check_tools.error = e?.message || String(e);
    return result;
  }
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

  // 2A) preview mode: single explicit query
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
    }
    return result;
  }

  // 2B) auto mode: scan entire text and check multiple sentences
  if (MODE === 'auto') {
    const base = result?.rewrite?.text || text || '';
    return await runAutoFactCheck(mcpClient, base, Number(stage ?? 0), result);
  }

  return result;
}
