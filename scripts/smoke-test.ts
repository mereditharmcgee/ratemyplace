import { parseSmokeArgs, runSmoke, type SmokeOptions } from '../src/lib/smoke';

async function main(): Promise<void> {
  let config: SmokeOptions;
  try {
    config = parseSmokeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Smoke configuration error: ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  console.log(`Smoke testing ${config.environment}: ${config.baseUrl.origin}`);
  const results = await runSmoke(config);
  for (const item of results) {
    const outcome = item.ok ? 'PASS' : 'FAIL';
    console.log(`${outcome} ${item.path} ${item.status} ${item.durationMs}ms${item.detail ? ` ${item.detail}` : ''}`);
  }
  if (results.some((item) => !item.ok)) process.exitCode = 1;
}

void main();
