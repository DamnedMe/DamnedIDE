// Self-check for Settings › SQL › query timeout against a real LocalDB (Windows only): the setting
// reopens the open pools with the new timeout, a query already running finishes, a connection's own
// longer (or under 30 s) execution timeout is kept. The rule is anchored at the real 30 s default,
// so the queries really wait; every scenario has its own SqlService and they run in parallel (~35 s).
// Run: node --experimental-strip-types scripts/sql-query-timeout.check.ts
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

if (process.platform !== 'win32') {
  console.log('sql query timeout: skipped (LocalDB is Windows only)')
  process.exit(0)
}

const require = createRequire(import.meta.url)
// CommonJS packages the service imports by name (esbuild allows it, node's ESM loader does not);
// built before the hooks, which also see require() and would loop
const cjsShims = new Map(['mssql', '@tediousjs/connection-string'].map(name => [name, `data:text/javascript,${encodeURIComponent(
  `import { createRequire } from 'node:module'; const m = createRequire(${JSON.stringify(import.meta.url)})(${JSON.stringify(name)}); export default m; ` +
  Object.keys(require(name)).filter(k => /^[A-Za-z_$][\w$]*$/.test(k)).map(k => `export const ${k} = m.${k};`).join(' ')
)}`]))

registerHooks({
  resolve(specifier, context, next) {
    // the service only uses BrowserWindow to broadcast data-tier logs
    if (specifier === 'electron') return { url: 'data:text/javascript,export const BrowserWindow = { getAllWindows: () => [] }', shortCircuit: true }
    const shim = context.conditions.includes('import') ? cjsShims.get(specifier) : undefined
    if (shim) return { url: shim, shortCircuit: true }
    try {
      return next(specifier, context)
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw e
    }
  },
  load(url, context, next) {
    if (!/\/electron\/.*\.ts$/.test(url)) return next(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
})
const { SqlService } = await import('../electron/services/sql/sql.service.ts')

setTimeout(() => {
  console.error('sql query timeout check: hard timeout')
  process.exit(2)
}, 150000).unref()

// LocalDB stops itself when idle
try { execFileSync('SqlLocalDB', ['start', 'MSSQLLocalDB'], { stdio: 'pipe' }) } catch { /* already running */ }

const server = '(localdb)\\MSSQLLocalDB'
const wait = (s: number) => `WAITFOR DELAY '00:00:${String(s).padStart(2, '0')}'; SELECT 1 AS done`
type Svc = InstanceType<typeof SqlService>
const open = async (setting: number, own?: number) => {
  const sql = new SqlService()
  await sql.setQueryTimeout(setting)
  const id = await sql.connect({ connectionId: 'qt', server, authType: 'sql', encrypt: false, ...(own ? { requestTimeout: own } : {}) })
  return { sql, id }
}
const finishes = async (sql: Svc, id: string, s: number) => {
  const r = await sql.executeQuery(id, wait(s))
  assert.equal(r.results[0]?.rows[0]?.done, 1)
}
const timesOut = (sql: Svc, id: string, s: number, ms: number) =>
  assert.rejects(sql.executeQuery(id, wait(s)), (e: Error) => e.message.includes(`failed to complete in ${ms}ms`), `expected a ${ms}ms timeout`)

const scenarios: Record<string, () => Promise<void>> = {
  'default 30 s stops a 32 s query': async () => {
    const { sql, id } = await open(30)
    await timesOut(sql, id, 32, 30000)
  },
  'raising to 1 min applies to the open connection': async () => {
    const { sql, id } = await open(30)
    await sql.setQueryTimeout(60)
    await finishes(sql, id, 32)
  },
  'lowering back to 30 s applies too': async () => {
    const { sql, id } = await open(60)
    await sql.setQueryTimeout(30)
    await timesOut(sql, id, 32, 30000)
  },
  'a running query survives the swap, the next one gets the new timeout': async () => {
    const { sql, id } = await open(30)
    const running = finishes(sql, id, 2)
    await new Promise(res => setTimeout(res, 300))
    await sql.setQueryTimeout(60)
    await running
    await finishes(sql, id, 32)
  },
  "a connection's own longer timeout is kept": async () => {
    const { sql, id } = await open(30, 40)
    await finishes(sql, id, 32)
  },
  "a connection's own timeout under 30 s is kept": async () => {
    const { sql, id } = await open(60, 1)
    await timesOut(sql, id, 2, 1000)
  },
  // the swap lands while the result is post-processed: describe runs on the replaced pool
  'a swap during result post-processing does not cut the metadata requests': async () => {
    const { sql, id } = await open(30)
    const svc = sql as unknown as { toQueryResult: (...a: unknown[]) => Promise<unknown> }
    const orig = svc.toQueryResult.bind(sql)
    let swapped = false
    svc.toQueryResult = async (...a: unknown[]) => {
      if (!swapped) { swapped = true; await sql.setQueryTimeout(90) }
      return orig(...a)
    }
    const r = await sql.executeQuery(id, 'SELECT TOP 1 name FROM sys.objects', undefined, undefined, 'master')
    assert.ok(swapped, 'post-processing ran')
    const source = r.results[0]?.source as { blocked?: string } | undefined
    assert.ok(!source?.blocked || !/clos/i.test(source.blocked), `metadata cut by the swap: ${source?.blocked}`)
  }
}

const outcomes = await Promise.all(Object.entries(scenarios).map(async ([name, run]) => {
  try {
    await run()
    console.log(`ok: ${name}`)
    return true
  } catch (e) {
    console.log(`FAIL: ${name}: ${(e as Error).message}`)
    return false
  }
}))
const failed = outcomes.filter(ok => !ok).length
console.log(failed ? `sql query timeout: ${failed} failed` : 'sql query timeout: all checks passed')
process.exit(failed ? 1 : 0)
