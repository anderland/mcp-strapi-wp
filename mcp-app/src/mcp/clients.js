import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import fs from 'node:fs';

let clients = { strapi: null, wp: null, factcheck: null };
let initPromise = null;

export async function getClients() {
  if (clients.strapi && clients.wp && clients.factcheck) return clients;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cwd = process.cwd();

    // Strapi MCP (stdio)
    try {
      const strapiScript = path.resolve(cwd, 'src/mcp/strapi-server.mjs');
      if (!fs.existsSync(strapiScript)) {
        throw new Error('Strapi MCP script not found at: ' + strapiScript);
      }
      const strapiEnv = {};
      if (process.env.STRAPI_URL) strapiEnv.STRAPI_URL = process.env.STRAPI_URL;
      if (process.env.STRAPI_TOKEN)
        strapiEnv.STRAPI_TOKEN = process.env.STRAPI_TOKEN;
      console.log(
        '[Next] Spawning Strapi MCP:',
        strapiScript,
        'env:',
        Object.keys(strapiEnv)
      );
      const strapiTransport = new StdioClientTransport({
        command: 'node',
        args: [strapiScript],
        env: strapiEnv,
        stderr: 'inherit',
        cwd,
      });
      const strapiClient = new Client(
        { name: 'next-demo', version: '1.0.0' },
        { capabilities: {} }
      );
      await strapiClient.connect(strapiTransport);
      clients.strapi = strapiClient;
      console.log('[Next] MCP (Strapi) connected');
    } catch (e) {
      console.warn(
        '[Next] Strapi MCP connect failed:',
        e?.stack || e?.message || e
      );
    }

    // WordPress MCP (stdio)
    try {
      const wpScript = path.resolve(cwd, 'src/mcp/wordpress-server.mjs');
      if (!fs.existsSync(wpScript)) {
        throw new Error('WordPress MCP script not found at: ' + wpScript);
      }
      const wpEnv = {};
      if (process.env.WORDPRESS_URL)
        wpEnv.WORDPRESS_URL = process.env.WORDPRESS_URL;
      if (process.env.WORDPRESS_USER)
        wpEnv.WORDPRESS_USER = process.env.WORDPRESS_USER;
      if (process.env.WORDPRESS_APP_PASSWORD)
        wpEnv.WORDPRESS_APP_PASSWORD = process.env.WORDPRESS_APP_PASSWORD;
      if (process.env.WORDPRESS_INSECURE_TLS)
        wpEnv.WORDPRESS_INSECURE_TLS = process.env.WORDPRESS_INSECURE_TLS;
      if (process.env.WORDPRESS_ALLOW_SELF_SIGNED)
        wpEnv.WORDPRESS_ALLOW_SELF_SIGNED =
          process.env.WORDPRESS_ALLOW_SELF_SIGNED;
      console.log(
        '[Next] Spawning WP MCP:',
        wpScript,
        'env:',
        Object.keys(wpEnv)
      );
      const wpTransport = new StdioClientTransport({
        command: 'node',
        args: [wpScript],
        env: wpEnv,
        stderr: 'inherit',
        cwd,
      });
      const wpClient = new Client(
        { name: 'next-demo', version: '1.0.0' },
        { capabilities: {} }
      );
      await wpClient.connect(wpTransport);
      clients.wp = wpClient;
      console.log('[Next] MCP (WordPress) connected');
    } catch (e) {
      console.warn(
        '[Next] WordPress MCP connect failed:',
        e?.stack || e?.message || e
      );
    }

    // Fact Check Tools MCP (stdio)
    try {
      const factScript = path.resolve(cwd, 'src/mcp/factcheck-server.mjs');
      if (!fs.existsSync(factScript)) {
        throw new Error('FactCheck MCP script not found at: ' + factScript);
      }
      const fcEnv = {};
      if (process.env.GOOGLE_FACT_CHECK_TOOLS_KEY)
        fcEnv.GOOGLE_FACT_CHECK_TOOLS_KEY =
          process.env.GOOGLE_FACT_CHECK_TOOLS_KEY;
      if (process.env.FACTCHECKTOOLS_API_KEY)
        fcEnv.FACTCHECKTOOLS_API_KEY = process.env.FACTCHECKTOOLS_API_KEY;
      if (process.env.FACT_CHECK_API_KEY)
        fcEnv.FACT_CHECK_API_KEY = process.env.FACT_CHECK_API_KEY;

      console.log(
        '[Next] Spawning FactCheck MCP (node):',
        factScript,
        'env:',
        Object.keys(fcEnv)
      );
      const factTransport = new StdioClientTransport({
        command: 'node',
        args: [factScript],
        env: fcEnv,
        stderr: 'inherit',
        cwd,
      });
      const fcClient = new Client(
        { name: 'next-demo', version: '1.0.0' },
        { capabilities: {} }
      );
      await fcClient.connect(factTransport);
      clients.factcheck = fcClient;
      console.log('[Next] MCP (FactCheck) connected');
    } catch (e) {
      console.warn(
        '[Next] FactCheck MCP connect failed:',
        e?.stack || e?.message || e
      );
    }

    return clients;
  })();

  return initPromise;
}

export async function fetchVerification(mcpClient, params) {
  try {
    const {
      query,
      languageCode = 'en',
      maxAgeDays = 365,
      pageSize = 3,
    } = params || {};

    if (!query) {
      throw new Error(
        'Query parameter is required for fact check verification'
      );
    }

    const clients = await getClients();
    const factcheckClient = clients.factcheck;

    if (!factcheckClient) {
      console.warn('FactCheck MCP client not available');
      return null;
    }

    const response = await factcheckClient.callTool({
      name: 'fact_check_search',
      arguments: {
        query,
        languageCode,
        maxAgeDays,
        pageSize,
      },
    });

    if (
      response &&
      response.content &&
      response.content[0] &&
      response.content[0].text
    ) {
      const result = JSON.parse(response.content[0].text);
      return result;
    }

    return null;
  } catch (error) {
    console.error('Error in fetchVerification:', error);
    return null;
  }
}
