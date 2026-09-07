# Leggi l’Opera d’Arte

Viewer didattico React per esplorare opere d’arte **dettaglio per dettaglio**. La collezione e tutti i contenuti (presentazione, sezioni per dettaglio su due livelli, opere simili, immagini) arrivano dalla **scheda didattica pubblicata con art-creator**: il viewer legge in sola lettura il database SQLite e presenta i testi già verificati, senza generazione al volo.

## Architettura

- `index.html`: entry point browser e UI React compilata in-browser per questa workspace.
- `src/styles.css`: fogli di stile principali (tabs, carosello opere simili, pannelli).
- `src/components/`: componenti React per catalogo, viewer, pannello di lettura e schermata di esplorazione.
- `src/data.js`: opera dimostrativa inclusa, usata solo come ripiego offline quando non ci sono schede pubblicate.
- `src/api/nvidiaAnalysis.js`: client legacy per l’analisi live (usato dal flusso dimostrativo).
- `src/App.jsx`: carica la libreria da `GET /api/library` e la scheda completa da `GET /api/artworks/:id`.
- `art-creator/`: app sorella che genera e pubblica le schede dei tre tipi (dipinto, soggetto, confronto) — pipeline AI sequenziale con feedback di avanzamento, editor a sezioni, approvazione con miniatura composita (PIL).
- `server.mjs`: server statico + API. Oltre agli endpoint di analisi live, espone la **libreria pubblicata** leggendo il DB di art-creator **in sola lettura** (connessioni `readOnly`, zero scritture).
- `test_server.mjs`: test automatici del backend e degli accessor read-only.

### Da dove vengono i contenuti mostrati

1. **Libreria** — `GET /api/library` elenca le opere con stato `ready` nel DB di art-creator (`art-creator/data/art-creator.db`), con le immagini servite dal BLOB.
2. **Scheda completa** — all’apertura di un’opera il browser chiama `GET /api/artworks/:id`: il server restituisce metadati, immagine pulita + URL dell’immagine annotata, `overview` (dipinto/artista), `details` con i testi `studio`/`approfondimento` per ciascun riquadro, fonti e le 10 `similarWorks` (thumbnail BLOB).
3. **Esplorazione** — la selezione di un dettaglio (dall’immagine o dalle chip) apre le due tab **Studio del dettaglio** e **Approfondimento** con le sezioni corrispondenti già compilate nella scheda; in cima alla pagina le tab **Presentazione | Opere simili** mostrano i testi e il carosello delle opere con lo stesso soggetto.

### Tre tipi di scheda

Oltre al singolo dipinto, la libreria include altri due tipi di scheda pubblicati da art-creator (stato `ready`):

- **Soggetto nella storia dell’arte** (`GET /api/subjects/:id`) — come lo stesso soggetto (Annunciazione, Natività, battaglie navali…) è stato rappresentato nei secoli: introduzione, origini iconografiche, **timeline per epoche** (capitoli ordinati), galleria di **opere rappresentative** con immagini BLOB, attributi/simboli ricorrenti, interpretazioni e curiosità. Vista React dedicata: `SubjectView.jsx`.
- **Faccia a faccia** (`GET /api/comparisons/:id`) — confronto critico di due opere (stesso soggetto tra artisti o stesso artista in due fasi): le due opere affiancate (lato dal DB o esterno con immagine BLOB), introduzione, **punti in comune / differenze** (elenchi strutturati), tecnica, contesto, interpretazione critica e curiosità. Miniatura composita (metà sinistra A + metà destra B) generata via PIL alla pubblicazione. Vista React dedicata: `ComparisonView.jsx`.

Le tabelle SQLite corrispondenti (`subjects`, `subject_chapters`, `subject_works`, `comparisons`, `comparison_sides`, `comparison_points`) vivono nello stesso DB di art-creator; artest le legge esclusivamente in sola lettura.

La chiave OpenRouter **non deve mai essere inserita in `index.html`, in `src/` o in un commit**. Copiare `.env.example` in `.env.local` e impostare `OPENROUTER_API_KEY`; il server carica il file automaticamente all’avvio. La chiave serve solo al flusso legacy di generazione live (analisi/overview/opere simili on-demand) e ad art-creator: il viewer delle schede pubblicate funziona anche senza.

## Avvio locale

La modalità raccomandata richiede Node.js 18 o superiore e non richiede pacchetti npm.

### macOS / Linux / Git Bash

```bash
cp .env.example .env.local  # poi inserisci OPENROUTER_API_KEY nel file
node server.mjs
```

### Windows PowerShell

```powershell
$env:OPENROUTER_API_KEY="incolla-la-tua-chiave-openrouter"
node server.mjs
```

Aprire quindi:

```text
http://127.0.0.1:8000
```

È possibile cambiare modello o porta senza modificare il codice:

```bash
OPENROUTER_VISION_MODEL="meta/muse-spark-1.3" OPENROUTER_TEXT_MODEL="meta/muse-spark-1.3" APP_PORT=8000 node server.mjs
```

Il modello lavora dalla propria conoscenza di addestramento: osserva il dettaglio e integra nella spiegazione i fatti che già conosce sull’opera. Il grounding web di OpenRouter è **disattivato di default**; per attivarlo impostare `OPENROUTER_WEB_SEARCH=true` (in quel caso il backend aggiunge il plugin di ricerca web alla richiesta e le citazioni restituite vengono mostrate tra le fonti).

## Modello scelto

Il backend usa come default il modello multimodale di Meta:

```text
meta/muse-spark-1.3
```

È il modello multimodale di Meta capace di ricevere testo più immagine e di ragionare. Viene usato per entrambi gli stadi della pipeline: osservazione visiva e spiegazione didattica. La variante `-contributor` è più economica ma richiede di abilitare la policy dati “paid model training” nelle impostazioni di privacy di OpenRouter; il modello standard funziona senza restrizioni. I modelli sono sostituibili tramite `OPENROUTER_VISION_MODEL` e `OPENROUTER_TEXT_MODEL` senza modificare il client React.

L’endpoint predefinito è:

```text
https://openrouter.ai/api/v1/chat/completions
```

Può essere sostituito tramite `OPENROUTER_ENDPOINT` per usare un endpoint compatibile.

## Flusso legacy (generazione live, per la demo inclusa e per prove)

I flussi sotto restano disponibili e vengono usati solo quando un’opera non ha contenuti pubblicati nel DB.

### Presentazione in cima alla pagina (`POST /api/overview`)

1. Aprendo la pagina dell’opera il browser chiede la presentazione storico-artistica di dipinto e artista.
2. Il backend invia al modello testo un prompt con i metadati dell’opera e le fonti editoriali.
3. Il modello risponde con JSON `{painting, artist}` (massimo 500 parole in totale).
4. La presentazione è mostrata sopra il viewer e viene messa in cache per artwork.

### Spiegazione del dettaglio (`POST /api/analyze`)

1. Il browser invia al backend opera, hotspot, coordinate, livello scolastico ed elenco degli altri dettagli notevoli.
2. Il backend legge l’immagine locale e la converte in data URI base64.
3. Il backend invia immagine e prompt strutturato al modello visione tramite OpenRouter.
4. Il backend passa l’osservazione visiva al modello testo per la spiegazione didattica del solo dettaglio selezionato (senza ripetere il contesto generale, già mostrato in cima alla pagina).
5. Il backend normalizza la risposta JSON del modello.
6. Il browser visualizza le tre sezioni **Cosa vedi**, **Cosa significa**, **In relazione all’opera**, oltre a confidenza e fonti.

L’immagine non viene inviata direttamente dal browser a OpenRouter e la chiave non viene esposta al client.

## Configuratore grafico della chiave Windows

È disponibile `setup_nvidia_key.py`, un mini-programma Tkinter che chiede la chiave senza stamparla e la salva in `HKCU\\Environment` come `NVIDIA_API_KEY`. Non crea file `.env` e non richiede privilegi amministrativi.

Avvio su Windows con Python installato:

```powershell
python setup_nvidia_key.py
```

Dopo il salvataggio chiudi e riapri il terminale, poi esegui `node server.mjs`. Per rimuovere la chiave è disponibile il pulsante **Rimuovi chiave**.

## Test

Eseguire i test Node integrati:

```bash
node --test test_server.mjs
```

È inoltre presente `test_server.py` come alternativa per ambienti Python, ma il percorso Node è quello verificato e raccomandato per questa workspace.

Il test live con OpenRouter richiede una chiave impostata nell’ambiente o in `.env.local`. Per sicurezza, la chiave condivisa in chat deve essere revocata e rigenerata prima dell’uso reale.
