import { rulesetPipeline } from '@/app/lib/ruleset-pipeline.js';
import { fetchVerification } from '@/mcp/clients.js';

const MODE = process.env.FACTCHECK_MODE || 'off'; // "off" | "preview"

export async function runWithVerification(mcpClient, input) {
  const { text, stage, factCheckQuery } = input || {};

  // 1) Run the pipeline as-is
  const result = await rulesetPipeline.invoke({ text, stage });

  // 2) Call MCP and attach a preview
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
