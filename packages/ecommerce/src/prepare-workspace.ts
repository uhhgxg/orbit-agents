import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fixturePath } from './assets.js';

/** Writes a NEW workspace artifact; never edits the user's existing ~/.craft-agent configuration. */
const root = resolve(process.argv[2] ?? '.state/demo-workspace');
if (existsSync(root))
  throw new Error('Target already exists; choose a new workspace directory');
const packageRoot = dirname(dirname(fixturePath()));
const server = join(packageRoot, 'dist/src/mcp-server.js');
if (!existsSync(server)) throw new Error('Run npm run build first');
for (const role of ['catalog', 'inventory', 'ads', 'reviewer']) {
  const slug = `commerce-${role}`;
  const folder = join(root, 'sources', slug);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'config.json'),
    JSON.stringify(
      {
        id: slug,
        slug,
        name: `经营证据 ${role}`,
        enabled: true,
        provider: 'commerce-snapshot',
        type: 'mcp',
        mcp: {
          transport: 'stdio',
          command: process.execPath,
          args: [server],
          env: {
            ECOMMERCE_ROLE: role,
            ECOMMERCE_REPLAY: 'true',
            ECOMMERCE_SNAPSHOT: fixturePath(),
            ECOMMERCE_STATE_DIR: join(root, 'state'),
          },
          authType: 'none',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(folder, 'guide.md'),
    `# ${role}\n\n只读经营快照。所有事实引用证据 ID 和时间窗。无经营写操作。\n`,
  );
  writeFileSync(
    join(folder, 'permissions.json'),
    JSON.stringify(
      {
        allowedMcpPatterns: [
          'query_.*$',
          ...(role === 'reviewer' ? ['review_report$'] : []),
        ],
      },
      null,
      2,
    ),
  );
}
const skills = join(root, 'skills/commerce-investigation');
mkdirSync(skills, { recursive: true });
writeFileSync(
  join(skills, 'SKILL.md'),
  readFileSync(join(packageRoot, 'examples/SKILL.md')),
);
const tasks = join(root, 'tasks/commerce-investigation');
mkdirSync(tasks, { recursive: true });
writeFileSync(
  join(tasks, 'task.yaml'),
  readFileSync(join(packageRoot, 'examples/task.yaml')),
);
console.log(
  JSON.stringify({
    root,
    task: join(tasks, 'task.yaml'),
    note: 'Register this directory as an Orbit workspace; sources and skills are ready. No live model call was made.',
  }),
);
