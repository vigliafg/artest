# Leggi l’Opera d’Arte

App didattica React per esplorare l’**Annunciazione del Beato Angelico** attraverso hotspot, selezione libera e analisi multimodale con il modello Meta Muse Spark tramite OpenRouter.

## Architettura

- `index.html`: entry point browser e UI React compilata in-browser per questa workspace.
- `src/components/`: componenti React separati per catalogo, viewer, analisi e schermata di esplorazione.
- `src/data.js`: catalogo e annotazioni editoriali.
- `src/api/nvidiaAnalysis.js`: client frontend dell’API `/api/analyze`.
- `server.py`: server statico e proxy server-side verso OpenRouter.
- `test_server.py`: test automatici del proxy e del parsing della risposta.

La chiave OpenRouter **non deve mai essere inserita in `index.html`, in `src/` o in un commit**. Copiare `.env.example` in `.env.local` e impostare `OPENROUTER_API_KEY`; il server carica il file automaticamente all’avvio.

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

## Flusso reale

1. Il browser invia al backend opera, hotspot, coordinate e livello scolastico.
2. Il backend legge l’immagine locale e la converte in data URI base64.
3. Il backend invia immagine e prompt strutturato al modello visione tramite OpenRouter.
4. Il backend passa l’osservazione visiva al modello testo per la spiegazione didattica.
5. Il backend normalizza la risposta JSON del modello.
6. Il browser visualizza osservazione, importanza, composizione, curiosità, collegamento, confidenza e fonti.

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
