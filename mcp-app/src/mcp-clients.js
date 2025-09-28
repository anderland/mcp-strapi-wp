import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import fs from 'node:fs';

let clients = { strapi: null, wp: null };
let initPromise = null;


export async function getClients() {
  if (clients.strapi && clients.wp) return clients;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cwd = process.cwd();

    // Strapi MCP (stdio)
    try {
      const strapiScript = path.resolve(cwd, 'src/mcp-strapi-server.mjs');
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
      const wpScript = path.resolve(cwd, 'src/mcp-wordpress-server.mjs');
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

    return clients;
  })();

  return initPromise;
}
