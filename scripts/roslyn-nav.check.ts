// End-to-end self-check for C# navigation (F12 / Ctrl+F12 / Ctrl+Shift+F12) against the
// RoslynBridge sidecar, on a throwaway fixture solution.
// Run: node --experimental-strip-types scripts/roslyn-nav.check.ts
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const DLL = join(import.meta.dirname, '..', 'ide-services', 'RoslynBridge', 'bin', 'Release', 'net8.0', 'RoslynBridge.dll')
if (!existsSync(DLL)) {
  console.error(`bridge non compilato: ${DLL}\nesegui: dotnet build -c Release ide-services/RoslynBridge`)
  process.exit(1)
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup>
</Project>
`

// Greet is declared on the interface and implemented by TWO classes, with Allman braces:
// the shape that used to make Ctrl+F12 fall through to the slow finder.
const CONTRACTS = `namespace Fixture;

public interface IGreeter
{
    string Greet(string name);
    string Salutation { get; }
}
`

const IMPL_A = `namespace Fixture;

public class LoudGreeter : IGreeter
{
    public string Salutation => "HI";

    public string Greet(string name)
    {
        return Salutation + name.ToUpperInvariant();
    }
}
`

const IMPL_B = `namespace Fixture;

public class SoftGreeter : IGreeter
{
    public string Salutation => "hi";

    public string Greet(string name)
    {
        return Salutation + name;
    }
}
`

// `greeter.Greet(...)` on line 9, column 36 sits on the call: F12 must resolve it to the
// interface declaration (DI-style, like Visual Studio), not to either implementation.
const CALLER = `namespace Fixture;

public class Caller
{
    private readonly IGreeter greeter;

    public Caller(IGreeter g) { greeter = g; }

    public string Run() => greeter.Greet("world");
}
`

const root = await mkdtemp(join(tmpdir(), 'roslyn-nav-'))
const src = join(root, 'src')
await mkdir(src, { recursive: true })
await writeFile(join(src, 'Fixture.csproj'), CSPROJ)
await writeFile(join(src, 'Contracts.cs'), CONTRACTS)
await writeFile(join(src, 'LoudGreeter.cs'), IMPL_A)
await writeFile(join(src, 'SoftGreeter.cs'), IMPL_B)
await writeFile(join(src, 'Caller.cs'), CALLER)

const proc = spawn('dotnet', [DLL], { stdio: ['pipe', 'pipe', 'inherit'] })
const pending = new Map<number, (v: any) => void>()
let nextId = 1
createInterface({ input: proc.stdout! }).on('line', (line) => {
  try {
    const msg = JSON.parse(line)
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
  } catch { /* not a response */ }
})

function send(cmd: string, payload: Record<string, unknown>, timeoutMs = 120000): Promise<any> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout su ${cmd}`)), timeoutMs)
    pending.set(id, (v) => { clearTimeout(t); resolve(v) })
    proc.stdin!.write(JSON.stringify({ id, cmd, ...payload }) + '\n')
  })
}

const norm = (p: string) => p.replace(/\\/g, '/')
const named = (targets: { file: string }[]) => targets.map(t => t.file.split('/').pop()).sort()

try {
  const opened = await send('open', { solution: join(src, 'Fixture.csproj') })
  assert.equal(opened.ok, true, 'open deve riuscire')

  // F12 on the call site → the interface declaration, not an implementation
  const def = await send('definition', { file: norm(join(src, 'Caller.cs')), line: 9, column: 36 })
  assert.equal(def.symbol, 'Greet', `F12 deve risolvere Greet, ottenuto ${def.symbol}`)
  assert.deepEqual(named(def.targets), ['Contracts.cs'], 'F12 su una chiamata deve portare alla dichiarazione di interfaccia')

  // Ctrl+F12 on the interface member → BOTH implementations, via the fast path
  const impl = await send('implementation', { file: norm(join(src, 'Contracts.cs')), line: 5, column: 12 })
  assert.deepEqual(named(impl.targets), ['LoudGreeter.cs', 'SoftGreeter.cs'],
    'Ctrl+F12 su un membro di interfaccia deve elencare ogni implementazione')

  // Ctrl+F12 on an interface PROPERTY (regressed before: only methods were matched)
  const implProp = await send('implementation', { file: norm(join(src, 'Contracts.cs')), line: 6, column: 19 })
  assert.deepEqual(named(implProp.targets), ['LoudGreeter.cs', 'SoftGreeter.cs'],
    'Ctrl+F12 deve funzionare anche sulle proprietà di interfaccia')

  // Ctrl+F12 on the interface TYPE → the classes implementing it
  const implType = await send('implementation', { file: norm(join(src, 'Contracts.cs')), line: 3, column: 18 })
  assert.deepEqual(named(implType.targets), ['LoudGreeter.cs', 'SoftGreeter.cs'],
    'Ctrl+F12 sul tipo interfaccia deve elencare i tipi che lo implementano')

  // Ctrl+Shift+F12 on the interface member → its declaration and the call site.
  // Implementations are distinct symbols, exactly as Visual Studio reports them.
  const refs = await send('references', { file: norm(join(src, 'Contracts.cs')), line: 5, column: 12 })
  assert.ok(refs.targets.length > 0, 'Ctrl+Shift+F12 deve trovare almeno un riferimento')
  assert.ok(named(refs.targets).includes('Caller.cs'), 'i riferimenti devono includere il punto di chiamata')

  // A second open on a DIFFERENT root must retarget the workspace: this is the worktree
  // switch that used to leave every query resolving against the previous worktree.
  const other = join(root, 'other')
  await mkdir(other, { recursive: true })
  await writeFile(join(other, 'Other.csproj'), CSPROJ)
  await writeFile(join(other, 'Solo.cs'), 'namespace Other;\n\npublic class Solo\n{\n    public int Value => 1;\n}\n')
  const reopened = await send('open', { solution: join(other, 'Other.csproj') })
  assert.equal(reopened.ok, true, 'riapertura su un altro root deve riuscire')
  const afterSwitch = await send('definition', { file: norm(join(other, 'Solo.cs')), line: 5, column: 16 })
  assert.equal(afterSwitch.symbol, 'Value', 'dopo il cambio root le query devono risolvere sui nuovi documenti')

  console.log('roslyn-nav: OK')
} finally {
  proc.kill()
  await rm(root, { recursive: true, force: true })
}
