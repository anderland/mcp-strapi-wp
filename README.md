# mcp-strapi-wp

Agent + MCP workflow demo. The core application is mcp-app (a Next.js app) that generates and validates editorial rewrites using a ruleset-guided pipeline (LangChain + OpenAI). Strapi and WordPress are demo targets used only to save the generated content via local MCP servers.

## Prerequisites

- Node.js LTS
- An OpenAI API key

(if you want to save drafts):

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
- Save to Strapi or WordPress
- Load Drafts to verify the saved items for each

## Ruleset pipeline (stages 0–7)

The pipeline in src/app/lib/ruleset-pipeline.js is a LangChain ChatOpenAI sequence that:

- Applies a style/quality RULESET to the input TEXT
- Returns JSON with analysis.findings and a rewrite.text
- Enforces anti-hallucination behavior

Stages progressively add constraints:

- 0: Baseline claims handling
- 1: Topic relevance gate
- 2: Extraordinary claims require in-TEXT corroboration (exclude if absent)
- 3: Internal coherence filter (includes temporal logic checks)
- 4: Harm/panic minimization
- 5: Quote/nickname discipline
- 6: External check (Independent 'sus' agent; advisory only, world knowledge allowed, no invention)
- 7: Selection-only assembly & sus gate (strip sentences with ≥ medium sus-flagged terms unless Stage‑2 corroboration exists)

Note: Stage 6 only logs sus flags (visible under `result._workshop.sus`); Stage 7 enforces gating based on those flags. When multiple red flags are detected (fictional entities, temporal inconsistencies, extraordinary claims), the system adds a `human_review_recommended` flag to alert editors.

Environment controls:

- OPENAI_MODEL, OPENAI_TEMPERATURE
- RULESET_STAGE (server default, 0–7) and RULESET_PATH (custom ruleset)

## Environment configuration

Create mcp-app/.env.local with your provider and factCheck settings. Restart the dev server after changes.

### LLM provider (OpenAI default or Gemini)

- LLM_PROVIDER=openai|gemini (default openai)
- OPENAI_MODEL=gpt-4o-mini (default)
- GEMINI_MODEL=gemini-2.5-flash (default)
  - You can also use gemini-1.5-flash
  - If you accidentally include a prefix like models/gemini-2.5-flash or a suffix like (default), the app sanitizes it
- GOOGLE_API_KEY=... (required when LLM_PROVIDER=gemini)
- OPENAI_TEMPERATURE=0.35 (default)

Examples:

OpenAI

```dotenv
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

Gemini

```dotenv
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_API_KEY=AIza...
```

Troubleshooting Gemini

- Ensure the Generative Language API is enabled in your GCP project (Google AI Studio API)
- If you see 400 "unexpected model name format": remove any "(default)" suffix; use gemini-2.5-flash or gemini-1.5-flash
- If your other app uses models/gemini-..., that’s fine here; we strip the "models/" prefix automatically
- If the model output includes markdown code fences, the app attempts to parse JSON robustly; an in-UI badge will show if parsing fails

### FactCheck (Google Fact Check Tools API)

- FACTCHECK_MODE=off|preview (default off)
  - preview: uses the explicit Fact-check query field in the UI. If external reviews exist and dispute outweighs support, the gate may remove sentences at Stage 6+.
- One of the following API key envs (any one will work):
  - GOOGLE_FACT_CHECK_TOOLS_KEY=...
  - FACTCHECKTOOLS_API_KEY=...
  - FACT_CHECK_API_KEY=...

UI notes

- The UI shows a “Fact-check query” input. When FACTCHECK_MODE=preview, gating uses this explicit query.
- A “Last run:” timestamp appears near the stage selector (persisted in localStorage).

Tuning (optional)

- FACTCHECK_CACHE_TTL_MS=300000 (5 minutes)
- FACTCHECK_CACHE_MAX=200

Behavior by stage

- Stage 6: Fact-check gate may remove sentences only when external reviews exist and dispute outweighs support
- Stage 7: SUS agent runs; SUS gate may remove sentences flagged medium/high (e.g., fictional terms) regardless of external reviews

### Caching (optional)

- LLM_CACHE_ENABLED=true (default)
- LLM_CACHE_TTL_MS=300000
- LLM_CACHE_MAX=200

### Other flags

- SUS_SALVAGE=false (default). When true, SUS-gated sentences try salvage by removing flagged terms instead of dropping whole sentences.

## API reference (from the Next.js app)

- POST /api/run

- Body: `{ text: string, stage?: number, options?: { clamp1500?: boolean } }`

  - Returns: `{ success, result: { corrected_text, report, agent, full } }`
  - The `full` object may include `human_review_recommended` when suspicious content is detected

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
