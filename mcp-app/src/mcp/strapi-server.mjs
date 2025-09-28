import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

class StrapiMCPServer {
  constructor() {
    this.server = new Server(
      { name: 'strapi-content-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    this.strapiUrl = process.env.STRAPI_URL || 'http://localhost:1337';
    this.strapiToken = process.env.STRAPI_TOKEN || '';

    this.setupTools();
    this.setupErrorHandling();
  }

  setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'save_draft',
          description: 'Save to Strapi (contents collection)',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              slug: { type: 'string' },
              source_text: { type: 'array' },
              generated_text: { type: 'array' },
              report: { type: 'object' },
              metadata: { type: 'object' },
            },
            required: ['source_text', 'generated_text', 'report'],
          },
        },
        {
          name: 'load_draft',
          description: 'Load a draft by ID from Strapi',
          inputSchema: {
            type: 'object',
            properties: { draft_id: { type: 'string' } },
            required: ['draft_id'],
          },
        },
        {
          name: 'list_drafts',
          description: 'List all drafts with pagination',
          inputSchema: {
            type: 'object',
            properties: {
              page: { type: 'number', default: 1 },
              limit: { type: 'number', default: 10 },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        if (name === 'save_draft') return await this.saveDraft(args);
        if (name === 'load_draft') return await this.loadDraft(args);
        if (name === 'list_drafts') return await this.listDrafts(args);
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

  async saveDraft(args) {
    const {
      title,
      slug,
      source_text,
      generated_text,
      report,
      metadata = {},
    } = args;
    const payload = {
      data: {
        ...(title ? { title } : {}),
        ...(slug ? { slug } : {}),
        source_text,
        generated_text,
        report,
        metadata: { ...metadata, saved_at: new Date().toISOString() },
        publishedAt: null,
      },
    };
    const res = await axios.post(`${this.strapiUrl}/api/contents`, payload, {
      headers: {
        Authorization: `Bearer ${this.strapiToken}`,
        'Content-Type': 'application/json',
      },
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ id: res.data.data.id }, null, 2),
        },
      ],
    };
  }

  async loadDraft({ draft_id }) {
    const res = await axios.get(`${this.strapiUrl}/api/contents/${draft_id}`, {
      headers: { Authorization: `Bearer ${this.strapiToken}` },
    });
    const d = res.data.data;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ id: d.id, ...d.attributes }, null, 2),
        },
      ],
    };
  }

  async listDrafts({ page = 1, limit = 10 }) {
    const params = {
      'pagination[page]': page,
      'pagination[pageSize]': limit,
      sort: 'createdAt:desc',
    };
    const res = await axios.get(`${this.strapiUrl}/api/contents`, {
      params,
      headers: { Authorization: `Bearer ${this.strapiToken}` },
    });
    const rows = Array.isArray(res.data?.data) ? res.data.data : [];
    const drafts = rows.map((d) => ({
      id: d?.id,
      title: d?.attributes?.title ?? '(untitled)',
      slug: d?.attributes?.slug ?? null,
      created_at: d?.attributes?.createdAt ?? d?.createdAt ?? null,
      status: d?.attributes?.publishedAt ? 'published' : 'draft',
    }));
    const pagination = res.data?.meta?.pagination ?? {
      page: 1,
      pageSize: drafts.length,
      pageCount: 1,
      total: drafts.length,
    };
    return {
      content: [
        { type: 'text', text: JSON.stringify({ drafts, pagination }, null, 2) },
      ],
    };
  }

  setupErrorHandling() {
    this.server.onerror = (e) => console.error('[MCP Strapi Error]', e);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Strapi MCP server running (stdio)');
  }
}

const server = new StrapiMCPServer();
server.run().catch((e) => console.error(e));
