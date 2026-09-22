import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const required = [
  'apps/worker/src/index.ts',
  'apps/worker/src/auth/passkey/routes.ts',
  'apps/worker/src/auth/sessions/store.ts',
  'apps/worker/src/routes/uploads.ts',
  'apps/worker/src/routes/videos.ts',
  'apps/worker/src/routes/jobs.ts',
  'apps/worker/src/routes/subtitles.ts',
  'apps/worker/src/routes/usage.ts',
  'apps/worker/src/jobs/pipeline.ts',
  'apps/worker/src/security/cleanup.ts',
  'database/migrations/0006_quota_reservation_period.sql',
  '.github/workflows/ci.yml',
  '.github/workflows/staging.yml',
  '.github/workflows/production.yml',
  '.gitcode/workflows/ci.yml',
];

for (const file of required) {
  if (!existsSync(join(process.cwd(), file))) throw new Error(`Missing production file: ${file}`);
}

const index = readFileSync('apps/worker/src/index.ts', 'utf8');
const requiredRoutes = [
  '/api/v1/auth',
  '/api/v1/auth/passkey',
  '/api/v1/uploads',
  '/api/v1/videos',
  '/api/v1/jobs',
  '/api/v1/subtitles',
  '/api/v1/usage',
];
for (const route of requiredRoutes) {
  if (!index.includes(`"${route}`)) throw new Error(`Required API mount is missing: ${route}`);
}

const sourceFiles = [
  'apps/worker/src',
  'packages',
  'scripts',
];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /AKIA[0-9A-Z]{16}/u,
  /sk-[A-Za-z0-9]{20,}/u,
];

for (const directory of sourceFiles) {
  const { execFileSync } = await import('node:child_process');
  const files = execFileSync('find', [directory, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) throw new Error(`Potential credential material found in ${file}`);
    }
  }
}

console.log(`Production contract validated: ${required.length} required files and ${requiredRoutes.length} API mounts.`);
