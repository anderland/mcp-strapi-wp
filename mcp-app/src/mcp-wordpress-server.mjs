#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import https from 'node:https';

function makeAuthHeader() {
  const user = process.env.WORDPRESS_USER || '';
  const appPassword = (process.env.WORDPRESS_APP_PASSWORD || '').replace(
    /\s+/g,
    ''
  );
  if (!user || !appPassword) return null;
  const token = Buffer.from(`${user}:${appPassword}`).toString('base64');
  return `Basic ${token}`;
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class WordPressMCPServer {
  constructor() {
    this.server = new Server(
      { name: 'wordpress-content-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.wpUrl = process.env.WORDPRESS_URL || '';
    this.authHeader = makeAuthHeader();
    this.insecureTls =
      process.env.WORDPRESS_INSECURE_TLS === '1' ||
      process.env.WORDPRESS_ALLOW_SELF_SIGNED === '1';
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: !this.insecureTls,
    });

    this.setupTools();
    this.setupErrorHandling();
  }

  setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'wp_save_draft',
          description: 'Save a draft to WordPress (title + HTML content only)',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['title', 'content'],
          },
        },
        {
          name: 'wp_load_post',
          description: 'Load a WordPress post by ID',
          inputSchema: {
            type: 'object',
            properties: { post_id: { type: 'string' } },
            required: ['post_id'],
          },
        },
        {
          name: 'wp_list_drafts',
          description: 'List draft posts',
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
        if (name === 'wp_save_draft') return await this.saveDraft(args);
        if (name === 'wp_load_post') return await this.loadPost(args);
        if (name === 'wp_list_drafts') return await this.listDrafts(args);
        throw new Error(`Unknown tool: ${name}`);
      } catch (error) {
        const details = error?.response?.data
          ? JSON.stringify(error.response.data)
          : error?.message || error?.code || String(error);
        return {
          content: [{ type: 'text', text: `Error: ${details}` }],
          isError: true,
        };
      }
    });
  }

  async saveDraft({ title, content }) {
    if (!this.wpUrl || !this.authHeader)
      throw new Error('WORDPRESS_URL/USER/APP_PASSWORD not set');

    const res = await axios.post(
      `${this.wpUrl}/wp-json/wp/v2/posts`,
      {
        title,
        content,
        status: 'draft',
      },
      {
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        httpsAgent: this.httpsAgent,
      }
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { id: res.data.id, link: res.data.link },
            null,
            2
          ),
        },
      ],
    };
  }

  async loadPost({ post_id }) {
    if (!this.wpUrl || !this.authHeader)
      throw new Error('WORDPRESS_URL/USER/APP_PASSWORD not set');
    const res = await axios.get(
      `${this.wpUrl}/wp-json/wp/v2/posts/${post_id}`,
      {
        headers: { Authorization: this.authHeader },
        httpsAgent: this.httpsAgent,
      }
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              id: res.data.id,
              title: res.data.title?.rendered,
              status: res.data.status,
              link: res.data.link,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async listDrafts({ page = 1, limit = 10 }) {
    if (!this.wpUrl || !this.authHeader)
      throw new Error('WORDPRESS_URL/USER/APP_PASSWORD not set');
    const res = await axios.get(`${this.wpUrl}/wp-json/wp/v2/posts`, {
      params: { status: 'draft', per_page: limit, page, context: 'edit' },
      headers: { Authorization: this.authHeader },
      httpsAgent: this.httpsAgent,
    });
    const data = res.data;
    if (!Array.isArray(data)) {
      throw new Error(
        `Unexpected WP response: ${
          typeof data === 'object' ? JSON.stringify(data) : String(data)
        }`
      );
    }
    const posts = data.map((p) => ({
      id: p.id,
      title: p.title?.rendered || '(untitled)',
      date: p.date,
      link: p.link,
    }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ posts }, null, 2) }],
    };
  }

  setupErrorHandling() {
    this.server.onerror = (e) => console.error('[MCP WP Error]', e);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('WordPress MCP server running (stdio)');
  }
}

const server = new WordPressMCPServer();
server.run().catch((e) => console.error(e));
