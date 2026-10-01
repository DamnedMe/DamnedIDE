// Compila il sidecar Roslyn (RoslynBridge) prima del packaging. Se il .NET SDK
// non è disponibile lo script termina senza errore: il package userà il binario
// già presente in ide-services/RoslynBridge/bin/Release, se c'è.
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const project = join('ide-services', 'RoslynBridge')
const dll = join(project, 'bin', 'Release', 'net8.0', 'RoslynBridge.dll')

const probe = spawnSync('dotnet', ['--version'], { stdio: 'ignore' })
if (probe.status !== 0) {
  console.warn('[roslyn-bridge] dotnet non trovato: salto la build (il sidecar resterà disabilitato nel package)')
  process.exit(0)
}

const build = spawnSync('dotnet', ['build', '-c', 'Release', project], {
  stdio: 'inherit',
  // Windows risolve dotnet.exe da PATH anche senza shell; la shell farebbe solo
  // scattare il warning DEP0190 sugli argomenti concatenati.
  shell: false
})
if (build.status !== 0) {
  console.warn('[roslyn-bridge] build fallita: proseguo con il binario esistente, se presente')
}

console.log(existsSync(dll) ? `[roslyn-bridge] pronto: ${dll}` : '[roslyn-bridge] DLL non trovata: navigazione C# disabilitata nel package')
