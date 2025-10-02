import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const BASE = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

// In-memory TTL cache to avoid repeated HTTP requests to Google
const FC_CACHE_TTL_MS = Number(process.env.FACTCHECK_CACHE_TTL_MS ?? 300000); // 5 min
const FC_CACHE_MAX = Number(process.env.FACTCHECK_CACHE_MAX ?? 200);
const fcCache = new Map(); // key -> { ts, value }
function fcCachePrune() {
  try {
    while (fcCache.size > FC_CACHE_MAX) {
      const k = fcCache.keys().next().value;
      if (typeof k === 'undefined') break;
      fcCache.delete(k);
    }
  } catch {}
}

function getApiKey() {
  return (
    process.env.GOOGLE_FACT_CHECK_TOOLS_KEY ||
    process.env.FACTCHECKTOOLS_API_KEY ||
    process.env.FACT_CHECK_API_KEY ||
    ''
  );
}

function bucketFromTextualRating(r = '') {
  const t = String(r || '').toLowerCase();
  if (/true|accurate|mostly true|correct/.test(t)) return 'support';
  if (/mixed|partly|half|somewhat/.test(t)) return 'mixed';
  if (/false|incorrect|debunk|misleading|pants on fire/.test(t))
    return 'dispute';
  return 'clarification';
}

async function googleFactCheckSearch({
  query,
  languageCode = 'en',
  maxAgeDays = 365,
  pageSize = 3,
  reviewPublisherSiteFilter,
}) {
  const key = getApiKey();
  if (!key) return { results: [], signals: { has_reviews: false } };

  const cacheKey = JSON.stringify({
    query,
    languageCode,
    maxAgeDays,
    pageSize,
    reviewPublisherSiteFilter,
  });
  const now = Date.now();
  const hit = fcCache.get(cacheKey);
  if (hit && now - hit.ts < FC_CACHE_TTL_MS) {
    return hit.value;
  }

  const params = {
    key,
    query,
    languageCode,
    maxAgeDays,
    pageSize,
    ...(reviewPublisherSiteFilter ? { reviewPublisherSiteFilter } : {}),
  };

  const resp = await axios.get(BASE, { params });
  const data = resp?.data || {};
  const claims = Array.isArray(data.claims) ? data.claims : [];

  const results = claims.map((c) => ({
    text: c?.text,
    claimant: c?.claimant,
    claimDate: c?.claimDate,
    reviews: Array.isArray(c?.claimReview)
      ? c.claimReview.map((r) => ({
          publisher: r?.publisher?.name || r?.publisher?.site,
          site: r?.publisher?.site,
          url: r?.url,
          title: r?.title,
          textualRating: r?.textualRating,
          reviewDate: r?.reviewDate,
          languageCode: r?.languageCode,
        }))
      : [],
  }));

  const flat = results.flatMap((r) => r.reviews || []);
  const counts = { support: 0, mixed: 0, dispute: 0, clarification: 0 };
  for (const r of flat) counts[bucketFromTextualRating(r?.textualRating)]++;

  const dates = flat
    .map((r) => r.reviewDate)
    .filter(Boolean)
    .sort();
  const signals = {
    has_reviews: flat.length > 0,
    review_count: flat.length,
    ratings: counts,
    oldest_review_date: dates[0] || null,
    latest_review_date: dates.at(-1) || null,
  };

  const value = { results, signals };
  fcCache.set(cacheKey, { ts: now, value });
  fcCachePrune();
  return value;
}

class FactCheckMCPServer {
  constructor() {
    this.server = new Server(
      { name: 'factcheck-tools', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    this.setupTools();
    this.setupErrorHandling();
  }

  setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'fact_check_search',
          description:
            'Search Google Fact Check Tools for a claim. Returns compact results + signals.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              languageCode: { type: 'string' },
              maxAgeDays: { type: 'number' },
              pageSize: { type: 'number' },
              reviewPublisherSiteFilter: { type: 'string' },
            },
            required: ['query'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        if (name === 'fact_check_search')
          return await this.factCheckSearch(args);
        throw new Error(`Unknown tool: ${name}`);
      } catch (error) {
        const details = error?.response?.data
          ? JSON.stringify(error.response.data)
          : error?.message || String(error);
        return {
          content: [{ type: 'text', text: `Error: ${details}` }],
          isError: true,
        };
      }
    });
  }

  async factCheckSearch(args = {}) {
    const { results, signals } = await googleFactCheckSearch({
      query: args?.query,
      languageCode: args?.languageCode,
      maxAgeDays: args?.maxAgeDays,
      pageSize: args?.pageSize,
      reviewPublisherSiteFilter: args?.reviewPublisherSiteFilter,
    });
    const payload = { query: args?.query, results, signals };
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
  }

  setupErrorHandling() {
    this.server.onerror = (e) => console.error('[MCP FactCheck Error]', e);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('FactCheck MCP server running (stdio)');
  }
}

const server = new FactCheckMCPServer();
server.run().catch((e) => console.error(e));
