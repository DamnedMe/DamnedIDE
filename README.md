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
| 📦 **Strip per worktree** | un badge per worktree con id del PBI, ↑/↓ rispetto al remoto e colore per modifiche pendenti (rosso) o commit non in develop (blu) |
| 🗃️ **Changes per tipologia** | nella lista delle modifiche il nome del file con la cartella sotto (tagliata dall'inizio, si può nascondere in Impostazioni › Git) e i file raggruppati per tipo: Controller, Service, Repository, DB (migration, context), Model / DTO, Interfacce, Helper, UI, Test, Configurazione, Documentazione. ok / ko / stage compaiono al passaggio del mouse (il nome resta barrato se ok, in grassetto rosso se ko); **unstage all** sulla zona staged e **scarta tutto** sui changes, con conferma e senza mai toccare i repository annidati (`.worktrees/…`) |
| 🧹 **Pulizia worktree** | propone i worktree inutili (PBI Done/Removed su ADO, già in develop) e li elimina in blocco, ricontrollando che nulla vada perso |
| 🚀 **Completa PR** | dall'intestazione del worktree: commit (con `#id` del work item), push, merge con develop, **creazione PR** verso develop con work item linkati |
| 🗂️ **Cambio repository** | selettore nella barra del titolo, accanto alle schede dei pannelli, con la **storia delle ultime 5 repo** |

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
| 🔑 **Connessioni nelle Impostazioni** | *Impostazioni › Azure DevOps › Connessioni*: più organization/project insieme, ognuna con il suo PAT, salvate solo se Azure DevOps risponde e condivise da tutte le finestre e le istanze dell'IDE |
| 🔒 **PAT cifrato** | cifrato dal keystore di sistema, non lascia mai il processo principale: l'interfaccia vede solo se è salvato. Le vecchie connessioni con il PAT in chiaro vengono migrate al primo avvio |
| 📁 **Repository per cartella** | ogni cartella (anche aperta da un suo worktree) usa la repository Azure DevOps con lo stesso nome; se ce ne sono più d'una o nessuna lo dice, fa scegliere e ricorda la scelta, modificabile in *Repository per cartella* |
| 🔗 **PBI / Bug / Task** | ricerca e dettaglio dei work item |
| 🔀 **Pull Request** | lista, dettaglio, **approve/reject/complete**, creazione con auto-complete opzionale e link ai work item |
| 🏷️ **Work item nei commit** | i commit del flusso worktree riportano `#id` → associazioni automatiche |
| 🚀 **Rilascio develop → qa → prod** | menu *Rilascio*: PR di promozione per BE, FE o entrambi, con i work item dei commit collegati, controllo delle PR già attive, conferma per la produzione; i branch develop/qa non vengono mai cancellati e le policy non vengono bypassate. Le repository **BE e FE** si scelgono da due menu e restano salvate per project (anche in *Impostazioni › Azure DevOps › Rilascio*, con la fase predefinita). La fase **develop → qa → prod** chiede una sola conferma, crea la PR develop → qa e, appena è completata, la PR qa → prod: le catene sono seguite ogni 30 s da una sola istanza dell'IDE, anche dopo un riavvio, con una notifica alla creazione |

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
| 🎨 **PK / FK evidenziate** | colori diversi, colonne ridimensionabili e pinnabili (rail a sinistra senza coprire le colonne precedenti) |
| 📋 **Copy righe** | `Ctrl+C` su righe selezionate in formato tab-separated |
| 📤 **Export risultati** | menu **esporta**: CSV, SQL INSERT e **Excel `.xlsx`** (numeri/booleani mantenuti, header in grassetto, riquadro bloccato) |
| 💾 **Backup & ripristino** | backup `.bak` scritto dal server, **restore** con `RESTORE FILELISTONLY` e MOVE automatici dei file logici, `REPLACE` opzionale |
| 📦 **Data-tier (DacFx)** | extract `.dacpac`, export e **import `.bacpac`** via SqlPackage, con log in tempo reale |
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
| **Icone** | [Ionicons](https://ionic.io/ionicons) (outline, MIT) in `src/components/icons` |
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
- Ogni aggiornamento di `main` incrementa automaticamente la versione patch, crea il tag GitHub e pubblica gli installer Windows, Linux e macOS. Se la build macOS fallisce (ad esempio per mancanza di runner macOS su GitHub), la release esce comunque con Windows e Linux e macOS arriva con la release successiva.
- Una release rimasta in bozza si ricompila da *Actions → Release → Run workflow* con `release_tag` (es. `v0.0.22`) e `source_ref` uguale al tag; una release già pubblicata non si può ricompilare.
- L'applicazione installata controlla gli aggiornamenti all'avvio e periodicamente; su Windows, macOS e AppImage scarica la nuova versione in background e la installa alla chiusura, oppure subito con **installa la versione X** (banner in basso a destra o *Impostazioni › Generale › Aggiornamenti*: un clic scarica, se serve, e installa).

Gli aggiornamenti OTA richiedono una versione installata tramite un installer prodotto da una GitHub Release. Il pacchetto macOS viene pubblicato anche in formato `zip`, usato da `electron-updater` per l'aggiornamento automatico.

**Più finestre aperte.** Ogni finestra di DamnedIDE è un processo a sé, ma la cache degli aggiornamenti di `electron-updater` è una sola (`%LOCALAPPDATA%\damned-ide-updater\pending`, `~/.cache/damned-ide-updater/pending`): una seconda istanza che la ricontrolla può svuotarla e cancellare l'installer scaricato dalla prima ("Impossibile trovare il file …\pending\DamnedIDE-Setup-x.exe"). Per questo gli aggiornamenti li gestisce **una sola istanza alla volta**, quella che tiene `updater.lock` nella cartella dati dell'app; le altre mostrano "un'altra finestra di DamnedIDE gestisce gli aggiornamenti" e subentrano da sole (o con *verifica aggiornamenti*) quando quella si chiude. Prima di installare da un file in cache l'IDE controlla che esista: se manca non installa, lo riscarica e lo dice.

**Log.** Controlli, versioni, download, comando di installazione, codice di uscita, coda dell'output e verifica finiscono in `logs/updater.log` nella cartella dati dell'app (una riga per evento con data ISO e pid dell'istanza; oltre 1 MB passa a `updater.old.log`). Quando un'installazione fallisce le impostazioni mostrano il percorso con il pulsante per copiarlo.

Su Linux `electron-updater` sceglie l'updater in base a `resources/package-type`:
- **AppImage** — si aggiorna da solo (richiede FUSE 2: su Arch installa `fuse2`, oppure avvia con `--appimage-extract-and-run`);
- **.deb / .pacman / .rpm** — l'IDE **scarica il pacchetto della distribuzione** (il feed `latest-linux.yml` lo include), ne copia una versione leggibile in una cartella nuova sotto `/tmp` (root e la sandbox di pacman non sempre leggono `~/.cache`) e la installa con `pkexec /usr/bin/pacman -U --noconfirm --overwrite '*'` (più `--disable-sandbox` solo se `pacman -Uh` lo elenca) / `pkexec dpkg -i` / `pkexec rpm -Uvh`: polkit mostra la richiesta di password, l'installazione è asincrona e l'app non si blocca (electron-updater non viene mai usato per installare). Dopo l'uscita 0 l'IDE **verifica la versione installata** (`pacman -Q damned-ide`, `dpkg-query -W -f='${Version}' damned-ide`, `rpm -q --qf '%{VERSION}' damned-ide`): se non è quella attesa lo segnala ("il gestore pacchetti non ha installato la X …") invece di dichiararla installata. A installazione riuscita compare **riavvia ora**; le altre finestre di DamnedIDE vanno chiuse anche loro, perché usano ancora la versione precedente. Se il feed non contiene il pacchetto, le impostazioni ripiegano sull'aggiornamento manuale (`sudo pacman -U damned-ide-<versione>.pacman`).

**Aggiornamento alla 0.0.23 (una tantum).** Lo esegue ancora l'updater della versione installata (0.0.22 o precedente), che non ha questi controlli: lock tra le finestre, copia in `/tmp`, verifica della versione e log arrivano con la 0.0.23 e valgono dagli aggiornamenti successivi. Windows: chiudi le altre finestre di DamnedIDE prima di installare. Linux pacman: installa la 0.0.23 a mano scaricando prima il file, `curl -fLO https://github.com/DamnedMe/DamnedIDE/releases/download/v0.0.23/damned-ide-0.0.23.pacman`, poi `sudo pacman -U --overwrite '*' ./damned-ide-0.0.23.pacman`, e controlla con `pacman -Q damned-ide`. Non passare l'URL direttamente a `pacman -U`: per un URL vale `RemoteFileSigLevel` (firma obbligatoria) e il pacchetto non è firmato, quindi pacman fallisce cercando `….pacman.sig` (404); per un file locale vale `LocalFileSigLevel = Optional`, il default di Arch e CachyOS, ed è anche il modo in cui installa l'updater dell'IDE. Dalla 0.0.23 in poi vale l'updater dell'IDE.

I pacchetti Linux dipendono solo da librerie presenti nei repository ufficiali della relativa distribuzione (per Arch: `gtk3`, `nss`, `libsecret`, `libxslt`, `minizip`, `libxtst`, `xdg-utils`, …).

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
└── resources/               # icon.ico · icon.png · licenses/ (licenze di terze parti)
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

Le icone sono [Ionicons](https://github.com/ionic-team/ionicons) © 2015-present Ionic, con licenza MIT: il testo della licenza è in [`resources/licenses/ionicons-LICENSE.txt`](resources/licenses/ionicons-LICENSE.txt) e viene distribuito con l'app (cartella `resources/licenses/` dell'installazione).
