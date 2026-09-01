# Leggi l’Opera d’Arte

App didattica React per esplorare l’**Annunciazione del Beato Angelico** attraverso hotspot, selezione libera e analisi multimodale NVIDIA.

## Architettura

- `index.html`: entry point browser e UI React compilata in-browser per questa workspace.
- `src/components/`: componenti React separati per catalogo, viewer, analisi e schermata di esplorazione.
- `src/data.js`: catalogo e annotazioni editoriali.
- `src/api/nvidiaAnalysis.js`: client frontend dell’API `/api/analyze`.
- `server.py`: server statico e proxy server-side verso NVIDIA.
- `test_server.py`: test automatici del proxy e del parsing della risposta.

La chiave NVIDIA **non deve mai essere inserita in `index.html`, in `src/` o in un commit**. Il server riconosce `NVIDIA_API_KEY` e, come fallback, `NVIDIA_NIM_API_KEY` o `NGC_API_KEY`.

## Avvio locale

La modalità raccomandata richiede Node.js 18 o superiore e non richiede pacchetti npm.

### macOS / Linux / Git Bash

```bash
export NVIDIA_API_KEY="incolla-la-tua-chiave-nvidia"
node server.mjs
```

### Windows PowerShell

```powershell
$env:NVIDIA_API_KEY="incolla-la-tua-chiave-nvidia"
node server.mjs
```

Aprire quindi:

```text
http://127.0.0.1:8000
```

È possibile cambiare modello o porta senza modificare il codice:

```bash
NVIDIA_MODEL="nvidia/nemotron-3-ultra-550b-a55b" APP_PORT=8000 node server.mjs
```

## Modello scelto

Il backend usa come default:

```text
nvidia/nemotron-3-ultra-550b-a55b
```

È un modello NVIDIA multimodale compatibile con il formato OpenAI Chat Completions e capace di ricevere testo più immagine. Il modello è sostituibile tramite `NVIDIA_MODEL` senza modificare il client React.

L’endpoint predefinito è:

```text
https://integrate.api.nvidia.com/v1/chat/completions
```

Può essere sostituito tramite `NVIDIA_ENDPOINT` per usare un endpoint compatibile.

## Flusso reale

1. Il browser invia al backend opera, hotspot, coordinate e livello scolastico.
2. Il backend legge l’immagine locale e la converte in data URI base64.
3. Il backend invia immagine e prompt strutturato a NVIDIA.
4. Il backend normalizza la risposta JSON del modello.
5. Il browser visualizza osservazione, importanza, composizione, curiosità, collegamento, confidenza e fonti.

L’immagine non viene inviata direttamente dal browser a NVIDIA e la chiave non viene esposta al client.

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

Il test live con NVIDIA richiede una chiave impostata nell’ambiente. Per sicurezza, la chiave condivisa in chat deve essere revocata e rigenerata prima dell’uso reale.
