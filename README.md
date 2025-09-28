# mcp-strapi-wp

Agent + MCP workflow demo. The core application is mcp-app (a Next.js app) that generates and validates editorial rewrites using a ruleset-guided pipeline (LangChain + OpenAI). Strapi and WordPress are demo targets used only to save the generated content via local MCP servers.

## Prerequisites

- Node.js LTS
- An OpenAI API key

Optional (if you want to save drafts):

- Strapi running locally or remotely and an API token
- A WordPress site with Application Passwords enabled

### Install Node (Mac or Linux) with nvm:

```bash
# Install and load nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Latest LTS
nvm install --lts
nvm use --lts
nvm alias default 'lts/*'
node -v
npm -v
```

If you see “nvm: command not found”:

```bash
`source ~/.zshrc` or `source ~/.bashrc`.
```

## Quick start: run the core app (mcp-app)

1. Create an env file: mcp-app/.env.local

```
OPENAI_API_KEY=your_key_here

# Optional tweaks
OPENAI_MODEL=gpt-4o-mini
OPENAI_TEMPERATURE=0.35
RULESET_STAGE=0

# Strapi
STRAPI_URL=http://localhost:1337
STRAPI_TOKEN=your_strapi_api_full_access_token

# WordPress
WORDPRESS_URL=https://example.com
WORDPRESS_USER=admin
WORDPRESS_APP_PASSWORD="xxxx xxxx xxxx xxxx"
```

2. Install and run

```bash
cd mcp-app
npm install
npm run dev
```

3. Open http://localhost:3000

- Paste source text, pick a stage, and Run
- Review the JSON report and the rewrite
- Optionally save to Strapi or WordPress via the selector and Save
- Load Drafts to verify the saved items for each

## Ruleset pipeline (stages 0–6)

The pipeline in src/app/lib/ruleset-pipeline.js is a LangChain ChatOpenAI sequence that:

- Applies a style/quality RULESET to the input TEXT
- Returns JSON with analysis.findings and a rewrite.text
- Enforces anti-hallucination behavior

Stages progressively add constraints:

- 0: Baseline claims handling
- 1: Topic relevance gate
- 2: Exclude extraordinary un-attributed claims
- 3: Internal coherence filter
- 4: Harm/panic minimization
- 5: Quote/nickname discipline
- 6: Assemble using only safe phrases

Environment controls:

- OPENAI_MODEL, OPENAI_TEMPERATURE
- RULESET_STAGE (server default) and RULESET_PATH (custom ruleset)

## API reference (from the Next.js app)

- POST /api/run

  - Body: `{ text: string, stage?: number, options?: { clamp1500?: boolean } }`
  - Returns: `{ success, result: { corrected_text, report, agent, full } }`

- POST /api/save-draft

  - Body for Strapi: `{ provider: 'strapi', title?, source_text, corrected_text, report, metadata? }`
  - Body for WordPress: `{ provider: 'wp', title, content }` (content is HTML)
  - Returns: `{ success, provider, data }` or a 5xx with `{ error }`

- GET /api/drafts?provider=strapi|wp&page=1&limit=10

  - Returns: `{ success, provider, data }` list of drafts/posts

- GET /api/ruleset
  - Returns: `{ success, ruleset, version }` where version is a SHA256 of the file

## Demo backends

### Strapi

Use the included bootstrap script to scaffold a Strapi instance with a minimal Content collection.

```bash
# From the repo root; default app name is "mcp-strapi"
node strapi-init.mjs
# Or choose an app name
node strapi-init.mjs --app-name my-strapi-app
```

- Admin panel: http://localhost:1337/admin
- Stop server: Ctrl+C
- Later: `cd mcp-strapi && npm run develop` (or build/start)

Generated Content collection fields: title, report (json), metadata (json), source_text (blocks), generated_text (blocks), slug (uid).

Create a Strapi Full Access API token in Admin → Settings → API Tokens and set in mcp-app/.env.local.

### WordPress

Provide a site with Application Passwords enabled, then set in mcp-app/.env.local:

The WordPress MCP saves drafts with title + HTML content only.

## How MCP is wired

- The Next.js server routes spawn the MCP servers as child processes over stdio:
  - src/mcp-strapi-server.mjs (tools: save_draft, list_drafts, load_draft)
  - src/mcp-wordpress-server.mjs (tools: wp_save_draft, wp_list_drafts, wp_load_post)
- Next.js is configured to treat @modelcontextprotocol/sdk as a server external (see next.config.mjs)
- If env vars for a provider are missing, the UI still works; save/list calls simply no-op or return a friendly message

## License

MIT — see [LICENSE](./LICENSE).
