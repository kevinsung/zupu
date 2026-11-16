// One-time import of seed/family.json into D1.
//   npm run seed -- --local     → local dev database
//   npm run seed -- --remote    → the deployed database
//   add --force to import even if people already exist
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { newId } from '../src/ids'
import { seedToPeople, type SeedEntry } from '../src/seed-format'

const target = process.argv.includes('--remote') ? '--remote' : process.argv.includes('--local') ? '--local' : null
if (!target) {
  console.error('Pass --local or --remote')
  process.exit(1)
}
const force = process.argv.includes('--force')

const wrangler = (...args: string[]) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'zupu', target, ...args], { encoding: 'utf8' })

const existing = JSON.parse(wrangler('--json', '--command', 'SELECT COUNT(*) AS n FROM people'))[0].results[0].n
if (existing > 0 && !force) {
  console.error(`The database already has ${existing} people; refusing to import twice. Use --force to import anyway.`)
  process.exit(1)
}

const sql = (s: string) => `'${s.replaceAll("'", "''")}'`
const people = seedToPeople(JSON.parse(readFileSync('seed/family.json', 'utf8')) as SeedEntry[], newId)
const lines = people.map(({ id, ...data }) => `INSERT INTO people (id, data) VALUES (${sql(id)}, ${sql(JSON.stringify(data))});`)
lines.push(`INSERT INTO changes (editor, at, summary, diffs) VALUES ('import', ${Date.now()}, ${sql(`匯入 Imported ${people.length} people`)}, '[]');`)
writeFileSync('seed/seed.sql', lines.join('\n') + '\n')

wrangler('--file', 'seed/seed.sql', '--yes')
console.log(`Imported ${people.length} people.`)
