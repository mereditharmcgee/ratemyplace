import { resolvePagesDeploymentOrigin, type PagesDeploymentOptions } from '../src/lib/pagesDeployment';

const flags = new Set(['--repository', '--sha', '--wait-ms']);

function parseArgs(args: string[]): Omit<PagesDeploymentOptions, 'token'> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flags.has(flag)) throw new Error('Unknown argument');
    if (!value || value.startsWith('--') || values.has(flag)) throw new Error('Invalid argument');
    values.set(flag, value);
  }
  const repository = values.get('--repository');
  const sha = values.get('--sha');
  const waitMs = values.get('--wait-ms');
  if (!repository || !sha || !waitMs || values.size !== flags.size) throw new Error('Missing required argument');
  if (!/^\d+$/.test(waitMs)) throw new Error('Invalid wait');
  return { repository, sha, waitMs: Number(waitMs) };
}

async function main(): Promise<void> {
  try {
    const origin = await resolvePagesDeploymentOrigin({ ...parseArgs(process.argv.slice(2)), token: process.env.GITHUB_TOKEN ?? '' });
    console.log(origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve Pages deployment';
    console.error(`Pages deployment resolver error: ${message}`);
    process.exitCode = 1;
  }
}

void main();
