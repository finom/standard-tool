// Refuses a release whose next version has no CHANGELOG section: its GitHub Release carries that section.
// node scripts/next-section.mjs patch|minor
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [major, minor, patch] = JSON.parse(readFileSync('package.json', 'utf8')).version.split('.').map(Number);
const next = process.argv[2] === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
const { status } = spawnSync(process.execPath, ['scripts/changelog-section.mjs', 'CHANGELOG.md', next], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.exit(status ?? 1);
