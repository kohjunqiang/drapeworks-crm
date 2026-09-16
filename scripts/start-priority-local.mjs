// Use an explicit sanitized environment: .env contains production credentials.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
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
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3003',
  NEXT_TELEMETRY_DISABLED: '1', NEXT_BUILD_DIR: '.next-priority',
});
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...(process.argv.includes('--build') ? ['build'] : ['dev', '--hostname', '127.0.0.1', '--port', '3003'])], { env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
