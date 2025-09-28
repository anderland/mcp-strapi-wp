// Usage: node strapi-init.mjs --app-name name-you-like

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { chdir } from 'node:process';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.findIndex((a) => a === `--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const APP_NAME = getArg('app-name', 'mcp-strapi');

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0) {
    console.error(`Command failed: ${cmd} ${cmdArgs.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

run('npx', [
  '-y',
  'create-strapi@latest',
  APP_NAME,
  '--no-run',
  '--js',
  '--skip-cloud',
  '--skip-db', // comment this line to choose a db other that sqlite
  '--no-example',
  '--install',
  '--no-git-init',
  '--use-npm',
]);

chdir(APP_NAME);

let pkg = {};
try {
  pkg = JSON.parse(readFileSync('package.json', 'utf8'));
} catch (e) {}
const isESM = pkg.type === 'module';

[
  'src/api/content/content-types/content',
  'src/api/content/controllers',
  'src/api/content/routes',
  'src/api/content/services',
].forEach((p) => mkdirSync(p, { recursive: true }));

writeFileSync(
  'src/api/content/content-types/content/schema.json',
  JSON.stringify(
    {
      kind: 'collectionType',
      collectionName: 'content',
      info: {
        singularName: 'content',
        pluralName: 'contents',
        displayName: 'Content',
        description: '',
      },
      options: { draftAndPublish: true },
      pluginOptions: {},
      attributes: {
        title: { type: 'string', required: true },
        report: { type: 'json' },
        metadata: { type: 'json' },
        source_text: { type: 'blocks' },
        generated_text: { type: 'blocks' },
        slug: { type: 'uid', targetField: 'title' },
      },
    },
    null,
    2
  )
);

const controllerESM = `import { factories } from "@strapi/strapi";
export default factories.createCoreController("api::content.content");
`;
const routerESM = `import { factories } from "@strapi/strapi";
export default factories.createCoreRouter("api::content.content");
`;
const serviceESM = `import { factories } from "@strapi/strapi";
export default factories.createCoreService("api::content.content");
`;
const indexESM = `export default { register() {}, bootstrap() {} };`;

const controllerCJS = `'use strict';
const { factories } = require('@strapi/strapi');
module.exports = factories.createCoreController('api::content.content');
`;
const routerCJS = `'use strict';
const { factories } = require('@strapi/strapi');
module.exports = factories.createCoreRouter('api::content.content');
`;
const serviceCJS = `'use strict';
const { factories } = require('@strapi/strapi');
module.exports = factories.createCoreService('api::content.content');
`;
const indexCJS = `module.exports = { register() {}, bootstrap() {} };`;

writeFileSync(
  'src/api/content/controllers/content.js',
  isESM ? controllerESM : controllerCJS
);
writeFileSync(
  'src/api/content/routes/content.js',
  isESM ? routerESM : routerCJS
);
writeFileSync(
  'src/api/content/services/content.js',
  isESM ? serviceESM : serviceCJS
);
writeFileSync('src/index.js', isESM ? indexESM : indexCJS);

run('npm', ['install']);
run('npm', ['run', 'develop']);
