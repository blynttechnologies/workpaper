import { readFileSync } from 'fs';
import path from 'path';

let cached: string | undefined;

/** The ID of the build this server runs (a new one for every deploy). Blank when there is no build, as under `next dev`. */
export function buildId(): string {
  if (cached === undefined) {
    try {
      cached = readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim();
    } catch {
      cached = '';
    }
  }
  return cached;
}
