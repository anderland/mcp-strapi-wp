import { rulesetPipeline } from '@/app/lib/ruleset-pipeline.js';
import { fetchVerification } from '@/mcp/clients.js';

const MODE = process.env.FACTCHECK_MODE || 'off'; // "off" | "preview"

export async function runWithVerification(mcpClient, input) {
  const { text, stage, factCheckQuery } = input || {};

  // 1) Run the pipeline with hardening (never throw)
  let result;
  try {
    result = await rulesetPipeline.invoke({ text, stage });
  } catch (e) {
    result = {
      version: 'mcp-demo/0.4',
      analysis: {
        findings: [],
        tone: { polarity: 'neutral', confidence: 0.5 },
      },
      rewrite: {
        text: '',
        rationale: [
          'fallback: pipeline error — blocked output',
          e && e.message ? `details: ${e.message}` : 'details: unknown error',
        ],
        ops: [],
      },
      _workshop: {
        stage: stage ?? 0,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      },
    };
  }

  // 2) Call MCP
  const enabled = MODE !== 'off' && !!factCheckQuery && !!mcpClient;
  if (!enabled) return result;

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
