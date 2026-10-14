export const COMMAND_NAME = 'workersphp';

export const log = (message) => console.error(`[${COMMAND_NAME}] ${message}`);

export class UsageError extends Error {}

export const USAGE = `usage: ${COMMAND_NAME} deploy --app <app-dir> --name <worker-name>
  [--framework laravel|plain] [--d1 <db-name>] [--email <from-address>]
  [--queue <queue-name>] [--cron <expr> ...] [--broadcast] [--r2 <bucket>]
  [--kv <namespace>] [--domain <apex-domain>] [--wasm <vendor-dir>]
  [--env K=V ...] [--out <dir>] [--bake] [--no-deploy]

  framework: laravel (default when artisan exists) or plain (when index.php
  exists). Plain PHP supports --r2, --kv, --domain, --env and --bake;
  --d1, --queue, --email, --broadcast and --cron need the Laravel bridge.`;
