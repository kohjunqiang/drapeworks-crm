// scripts/start-invoice-journey-local.mjs
//
// Local QA launcher for the invoice → deposit → manufacturing journey.
// Same sanitized-env pattern as start-priority-local.mjs (.env carries
// production credentials and is wiped), plus:
//   * a separate build dir and port (3005) so it can coexist with the
//     priority-local instance;
//   * ZOHO_CONNECTION_ENV=local-fixture + the fixture token key, matching the
//     zoho_connections row written by scripts/seed-local-invoice-journey.ts;
//   * NODE_OPTIONS --import of scripts/zoho-fixture-preload.mjs, which
//     intercepts fetch and serves only the seeded Zoho reads — every payment,
//     write or unexpected Zoho call throws. No real credentials or network.
//
// Run AFTER: setup-priority-local.ts, seed-local-admin.ts,
//            seed-local-invoice-journey.ts
// Then open: http://localhost:3005/orders/00000000-0000-4000-8000-0000000000f1

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/invoice-journey-fixture.json', import.meta.url))),
);
const preload = new URL('./zoho-fixture-preload.mjs', import.meta.url).href;

const env = { ...process.env };
for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  let values = {};
  try { values = parse(readFileSync(file)); } catch {}
  for (const key of Object.keys(values)) env[key] = '';
}
for (const key of Object.keys(env)) {
  if (/^(SUPABASE|NEXT_PUBLIC_SUPABASE|GOOGLE_|ZOHO_|TELEGRAM_|DATABASE_)/.test(key)) env[key] = '';
}
Object.assign(env, {
  DATABASE_URL: 'postgresql://127.0.0.1:55439/drapeworks_priority_local',
  DATABASE_POOL_MAX: '3', LOCAL_DEV_AUTH_BYPASS: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55440',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-only',
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3005',
  NEXT_TELEMETRY_DISABLED: '1', NEXT_BUILD_DIR: '.next-invoice-journey',
  ZOHO_CONNECTION_ENV: fixture.environment,
  ZOHO_TOKEN_ENCRYPTION_KEY: fixture.tokenEncryptionKeyBase64,
  NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --import ${preload}`.trim(),
});
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', ...(process.argv.includes('--build') ? ['build'] : ['dev', '--hostname', '127.0.0.1', '--port', '3005'])],
  { env, stdio: 'inherit' },
);
child.on('exit', code => process.exit(code ?? 0));
