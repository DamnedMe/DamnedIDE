<div align="center">

<pre>

   ██████╗  █████╗ ███╗   ███╗███╗   ██╗███████╗██████╗ ██╗██████╗ ███████╗
   ██╔══██╗██╔══██╗████╗ ████║████╗  ██║██╔════╝██╔══██╗██║██╔══██╗██╔════╝
   ██║  ██║███████║██╔████╔██║██╔██╗ ██║█████╗  ██║  ██║██║██║  ██║█████╗
   ██║  ██║██╔══██║██║╚██╔╝██║██║╚██╗██║██╔══╝  ██║  ██║██║██║  ██║██╔══╝
   ██████╔╝██║  ██║██║ ╚═╝ ██║██║ ╚████║███████╗██████╔╝██║██████╔╝███████╗
   ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝╚═════╝ ╚═╝╚═════╝ ╚══════╝

</pre>

<h3>un IDE <em>diverso</em> — leggero, open source, senza limiti.</h3>

<p><em>Dove <span style="color:#2563EB">worktree</span> · <span style="color:#4F46E5">editor</span> · <span style="color:#7C3AED">Azure DevOps</span> · <span style="color:#9333EA">SQL Server</span> vivono in un unico posto.</em></p>

<pre>

        ◆  worktree  ◆  editor  ◆  azure devops  ◆  sql server  ◆  terminale  ◆

</pre>

</div>

---

## 🔮 Il concept

**DamnedIDE** nasce per lo sviluppatore **.NET** che vuole un IDE **veloce da avviare**, **comodo da usare** e **senza limitazioni** — un'alternativa open source a Visual Studio, pensata attorno a un flusso di lavoro reale: *branch, worktree, Pull Request e query al database senza mai lasciare l'editor*.

> ⚡ *"Se serve fare una cosa in più di tre click, probabilmente stiamo sbagliando."*

---

## ✨ Funzionalità

<details open>
<summary><strong>🧭 Worktree · il flusso Git al centro di tutto</strong></summary>

| | |
|---|---|
| 🪵 **Worktree paralleli** | crea `feature/{id}` da un PBI, lavora in isolamento, senza toccare il branch principale |
| 📦 **Strip per worktree** | lista compatta di tutti i worktree con selezione istantanea |
| 🚀 **Completa worktree** | commit (con `#id` del work item), push, merge con develop, **creazione PR** verso develop con work item linkati |
| 🗂️ **Cambio cartella** | pulsante folder nella sidebar per passare da una repo all'altra, con la **storia delle ultime 5 repo** |

</details>

<details open>
<summary><strong>📝 Editor · Monaco, ma con i superpoteri C#</strong></summary>

| | |
|---|---|
| 🧠 **Navigazione semantica C# (Roslyn)** | `F12` definizione, `Ctrl+F12` implementazione (con picker se ci sono più classi), `Ctrl+Shift+F12` riferimenti |
| 💡 **Hover da IDE** | firma + summary XML doc sui metodi, tipo su proprietà e variabili |
| 🩺 **Errori live** | diagnostica del compilatore con sottolineature e conteggio errori/warning, anche con modifiche non salvate |
| 🔎 **Find All References** | elenco puntuale dei riferimenti con navigazione |
| 🧭 **Navigazione avanti/indietro** | stile Visual Studio (`Ctrl+-` / `Ctrl+Shift+-`) o VS Code (`Alt+←/→`), configurabile |
| 🎨 **Temi personalizzati** | tema scuro/chiaro, **colore primario personalizzabile**, colori di sintassi C# |
| 📌 **Colonne pinnabili + resize** | nella griglia SQL: colonne fissate a sinistra, larghezze regolabili |

</details>

<details open>
<summary><strong>☁️ Azure DevOps · il lavoro senza uscire dall'IDE</strong></summary>

| | |
|---|---|
| 🔗 **PBI / Bug / Task** | ricerca e dettaglio dei work item |
| 🔀 **Pull Request** | lista, dettaglio, **approve/reject/complete**, creazione con auto-complete opzionale e link ai work item |
| 🏷️ **Work item nei commit** | i commit del flusso worktree riportano `#id` → associazioni automatiche |

</details>

<details open>
<summary><strong>🗄️ SQL Server · query e risultati come un vero tool</strong></summary>

| | |
|---|---|
| 🖇️ **Connector LocalDB** | named pipe via registry, con connessioni **persistenti** ripristinate all'avvio |
| 🔐 **Connessioni stile SSMS 2022** | 8 tipi di autenticazione (Windows, SQL, Azure AD Password/Default/Service Principal/MSI/Access Token), test connection, connection string ADO.NET con parse inverso, cronologia recenti |
| 🌳 **Object Explorer** | albero server → database → tabelle/views/programmabilità con lazy-load, **refresh singolo DB o tutti**, modalità *essentials* (solo tabelle · diagramma · programmabilità) |
| 🖱️ **Click su tabella** | *Select Top 1000 / Top N / tutte*, *Script table as* CREATE/SELECT/INSERT/UPDATE/DELETE |
| ⚡ **Risultati virtualizzati** | griglia a finestra (windowing) per centinaia di migliaia di righe senza lag, multi-result set, righe affette, tempi di esecuzione |
| 🧭 **ER Diagram** | diagramma auto-generato con relazioni FK, tabelle trascinabili, pan/zoom, export SVG/PNG |
| 🎨 **PK / FK evidenziate** | colori diversi, colonne ridimensionabili e pinnabili |
| 📋 **Copy righe** | `Ctrl+C` su righe selezionate in formato tab-separated |
| ⏹️ **Cancellazione query** | esecuzione annullabile, editor Monaco SQL con `F5` |
| 🗓️ **Date formattate** | `dd/MM/yyyy HH:mm:ss.fffff` |

</details>

<details open>
<summary><strong>🖥️ Terminale & integrazioni</strong></summary>

| | |
|---|---|
| 🖥️ **Terminale a schede** | cmd / PowerShell / PowerShell 7, con finestra detached |
| 🛠️ **Build & Run** | rileva `dotnet` / `node`, avvia, ferma e riavvia con output in pannello |
| 🔌 **Git bar** | branch, stage/unstage, diff, blame, history, pull/push/fetch dall'editor |

</details>

---

## 🧰 Tech stack

| Livello | Tecnologia |
|---------|-----------|
| **Renderer** | React 18 · TypeScript · Vite · Zustand |
| **Editor** | Monaco Editor · xterm.js |
| **Main (Electron)** | Electron 28 · IPC |
| **Servizi** | simple-git · mssql · child_process |
| **Navigazione C#** | Roslyn (Microsoft.CodeAnalysis) in un **sidecar .NET** con riferimento ai pacchetti NuGet del progetto |

```
   ┌─────────────────────────────────────────────────────┐
   │                    RENDERER (React)                 │
   │   Monaco · FileTree · Worktree · ADO · SQL · Term   │
   └───────────────────────┬─────────────────────────────┘
                           │ IPC
   ┌───────────────────────▼─────────────────────────────┐
   │                 ELECTRON MAIN                       │
   │   git · worktree · ado · sql · process · terminal   │
   └───────────────┬──────────────────────────┬──────────┘
                   │                          │  stdout/JSON
   ┌───────────────▼────────────┐   ┌─────────▼──────────────────┐
   │          fs / git          │   │      ROSLYN BRIDGE (.NET)  │
   │        SQL Server          │   │  parse + diagnostica +     │
   │        LocalDB             │   │  definizioni/implementazioni│
   └────────────────────────────┘   └────────────────────────────┘
```

---

## 🚀 Primi passi

```bash
# 1. dipendenze
npm install

# 2. build del bridge C# (indice di navigazione)
cd ide-services/RoslynBridge && dotnet build -c Release && cd ../..

# 3. avvio in sviluppo
npm run dev

# 4. build di produzione
npm run build

# 5. pacchetto (installer NSIS / AppImage / deb / pacman / dmg)
npm run package
```
> Requisiti: **Node.js** ≥ 18, **.NET SDK** 8+ (per la navigazione C# e i progetti .NET).

### Sviluppo e aggiornamenti

- `develop` e' il ramo di lavoro quotidiano.
- Le modifiche arrivano in `main` tramite Pull Request da `develop`.
- Ogni aggiornamento di `main` incrementa automaticamente la versione patch, crea il tag GitHub e pubblica gli installer Windows, Linux e macOS.
- L'applicazione installata controlla gli aggiornamenti all'avvio e periodicamente, scarica la nuova versione in background e propone il riavvio per installarla.

Gli aggiornamenti OTA richiedono una versione installata tramite un installer prodotto da una GitHub Release. Il pacchetto macOS viene pubblicato anche in formato `zip`, usato da `electron-updater` per l'aggiornamento automatico. Su Linux l'OTA e' supportato dall'AppImage; i pacchetti `.deb` e `.pacman` (Arch Linux) vanno aggiornati tramite una nuova installazione o il package manager.

---

## ⌨️ Scorciatoie

| Scorciatoia | Azione |
|---|---|
| `F12` | Vai alla definizione |
| `Ctrl+F12` | Vai all'implementazione |
| `Ctrl+Shift+F12` | Trova tutti i riferimenti |
| `Ctrl+-` / `Ctrl+Shift+-` | Indietro / avanti (VS) — `Alt+←/→` (VS Code, configurabile) |
| `Ctrl+S` | Salva |
| `Ctrl+Shift+F` | Ricerca globale |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom editor |
| `F5` | Esegui query SQL |

### Test SQL Server

La sezione SQL dispone di due livelli di verifica separati:

```bash
# test deterministici di parser JOIN, layout diagramma e matematica griglia
npm run test:sql-ui

# test Playwright con bridge Electron mockato e dati massivi
npx playwright install chromium
npm run test:sql-playwright

# entrambi
npm run test:sql
```

La suite Playwright copre query a tab, SELECT dal menu contestuale, feedback delle operazioni,
modalità essenziali, JOIN da FK, conferme UPDATE/DELETE e diagrammi ciclici. I profili prestazionali
usano 250.000 righe, 5.000 righe × 240 colonne e un diagramma da 300 tabelle/300 relazioni.
Le metriche sono allegate al report HTML in `playwright-report/sql` e aggregate in
`test-results/sql-performance.json`; per aprire il report:

```bash
npm run test:sql-playwright:report
```

---

## 🧱 Struttura del progetto

```
DamnedIDE/
├── electron/                # processo main
│   └── services/            # git · ado · sql · roslyn · process · terminal
├── ide-services/
│   └── RoslynBridge/        # sidecar .NET (Microsoft.CodeAnalysis)
├── src/
│   ├── components/          # UI (worktree · editor · ado · sql · terminal …)
│   ├── store/               # Zustand (settings · sql · ado · recent · diff)
│   ├── utils/               # colori · diagnostica C# · hover C#
│   └── styles/              # temi dark / light
├── scripts/
│   └── generate-icon.mjs    # rigenera icone da src/assets/logo.png
└── resources/               # icon.ico · icon.png
```

---

## 🤝 Contribuire

1. **Fork** il repository
2. Crea il tuo branch: `git checkout -b feature/il-tuo-id`
3. Committa con il riferimento al work item: `#123 : descrizione`
4. Apri una Pull Request verso `main` (o `develop`)

Gli stessi tool che usi per sviluppare li trovi già dentro l'IDE. 😉

---

## 📄 Licenza

MIT — sentiti libero di prendere ciò che ti serve, e se lo migliori, restituiscilo alla community.
