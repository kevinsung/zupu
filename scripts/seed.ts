// Import a seed file (see src/seed-format.ts) into D1.
//   npm run seed -- --local                    → local dev database, from seed/family.json
//   npm run seed -- --local --file <path>      → local dev database, from another file
//   npm run seed -- --remote --file <path>     → the deployed database (the file must be named explicitly)
//   add --force to import even if people already exist
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { newId } from '../src/ids'
import { seedToPeople, type SeedEntry } from '../src/seed-format'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)

const target = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : null
if (!target) {
  console.error('Pass --local or --remote')
  process.exit(1)
}
const force = args.includes('--force')

const fileIndex = args.indexOf('--file')
const fileArg = fileIndex >= 0 ? args[fileIndex + 1] : undefined
if (fileIndex >= 0 && (!fileArg || fileArg.startsWith('--'))) {
  console.error('--file needs a path')
  process.exit(1)
}
if (target === '--remote' && !fileArg) {
  console.error('Importing into the deployed database needs an explicit --file <path>')
  process.exit(1)
}
// --file paths are relative to where the command was run; the default is relative to the repo.
const file = fileArg ? resolve(fileArg) : join(root, 'seed', 'family.json')

const wrangler = (...wranglerArgs: string[]) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'zupu', target, ...wranglerArgs], { cwd: root, encoding: 'utf8' })

const existing = JSON.parse(wrangler('--json', '--command', 'SELECT COUNT(*) AS n FROM people'))[0].results[0].n
if (existing > 0 && !force) {
  console.error(`The database already has ${existing} people; refusing to import twice. Use --force to import anyway.`)
  process.exit(1)
}

const sql = (s: string) => `'${s.replaceAll("'", "''")}'`
const people = seedToPeople(JSON.parse(readFileSync(file, 'utf8')) as SeedEntry[], newId)
const lines = people.map(({ id, ...data }) => `INSERT INTO people (id, data) VALUES (${sql(id)}, ${sql(JSON.stringify(data))});`)
lines.push(`INSERT INTO changes (editor, at, summary, diffs) VALUES ('import', ${Date.now()}, ${sql(`匯入 Imported ${people.length} people`)}, '[]');`)

// The generated SQL holds the same personal data as the seed file, so keep it out of the repo and delete it afterwards.
const dir = mkdtempSync(join(tmpdir(), 'zupu-seed-'))
try {
  const sqlFile = join(dir, 'seed.sql')
  writeFileSync(sqlFile, lines.join('\n') + '\n')
  wrangler('--file', sqlFile, '--yes')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`Imported ${people.length} people.`)
