# art-creator · app sorella di artest

Applicazione di **authoring dei contenuti didattici**: carichi l'immagine di un
dipinto e l'LLM propone l'intera scheda (opera, artista, dettagli notevoli e
tutte le sezioni didattiche). Tu rivedi, correggi e **salvi nel database** con
un clic. La sorella **artest** resta l'app di lettura/esplorazione.

## Stack

- **Zero dipendenze**: Node ≥ 22.5, solo moduli nativi (`node:http`,
  `node:sqlite`). Nessun `npm install`.
- **Database**: SQLite singolo file (`data/art-creator.db`, modalità WAL),
  schema normalizzato: `artworks` → `details` (hotspot con regioni 0–1) →
  `detail_content` (7 campi per dettaglio × tab `studio`/`approfondimento`),
  più `overview` (testo opera + artista) e `sources`.
- **Immagini nel DB (BLOB, non base64)**: ogni opera memorizza **due** versioni
  in colonne BLOB — `image_data` (l'immagine pulita originale) e
  `annotated_data` (riquadri oro + didascalie numerate dei dettagli, resa da
  `annotate.py` via PIL). Servite come binario da
  `/api/artworks/:id/image` e `/api/artworks/:id/image-annotated`; il file in
  `uploads/` resta solo scratch per PIL. Le due immagini vengono esportate nel
  publish JSON (campi `imageUrl` / `annotatedImageUrl`) per artest. La BLOB
  binaria evita l'+33% di base64 e si serve senza decodifica.
- **Modelli**: riusa il motore di artest (`../server.mjs`): modello **visione**
  per riconoscimento opera, proposta dettagli e osservazione del crop; modello
  **testo** per le sezioni. Chiave `OPENROUTER_API_KEY` da `.env.local`/`.env`
  alla radice del repo.

## Avvio

```bash
cd art-creator
node server.mjs            # http://127.0.0.1:8100  (porta: ART_CREATOR_PORT)
```

DB e cartella `uploads/` si creano da soli al primo avvio; sono ignorati da git
(artefatti runtime). Il DB demo con l'Annunciazione (stato `ready`) è presente
solo localmente.

## Flusso d'uso (una sola richiesta all'utente: l'immagine)

1. **+ Nuova opera** → carica l'immagine del dipinto.
2. Il modello **riconosce l'opera** e compila da solo la scheda (titolo,
   artista, data, periodo, tecnica, istituzione, collocazione).
3. **Proponi dettagli** → il modello visione individua 4–6 dettagli notevoli
   come rettangoli normalizzati sovrapposti all'immagine; **subito dopo viene
   generata e salvata l'immagine annotata** (riquadri oro + didascalie
   numerate, una per dettaglio, mai sovrapposte).
4. **Genera tutte le tab** (o tab singola) → per ogni dettaglio vengono create
   le due tab, coerenti con artest:
   - **Studio del dettaglio**: `observation` · `meaning` · `relation` ·
     `lookAgain` (Cosa vedi / Cosa significa / In relazione all'opera /
     Guarda ancora).
   - **Approfondimento**: `curiosity` · `comparisons` · `openQuestions` ·
     `lookAgain` (Una curiosità / Confronti / Questioni aperte). La curiosità
     è opzionale per progetto (mai inventata).
5. **Genera presentazione** → testo "Il dipinto" + "L'artista".
6. **💾 Salva nel database** → genera i contenuti mancanti, renderizza
   l'**immagine annotata** (`annotate.py`: riquadri + didascalie), approva
   tutto, marca l'opera `ready` e torna alla home con feedback positivo.
7. Dalla home, **Vedi** apre il viewer elegante (overview, hotspot cliccabili,
   le due tab per dettaglio) con toggle 🖼 **Vista pulita / Mostra riquadri**:
   mostra l'immagine pulita oppure quella annotata conservata nel DB.

## API principali

| Metodo | Percorso | Scopo |
|---|---|---|
| POST | `/api/artworks` | crea opera (upload `imageDataUrl` base64) |
| GET | `/api/artworks` · `/api/artworks/:id` | elenco / scheda completa |
| POST | `/api/artworks/:id/generate/meta` | riconoscimento opera (visione) |
| POST | `/api/artworks/:id/generate/details` | proposta dettagli (visione) |
| POST | `/api/details/:id/generate/:tab` | contenuto di una tab (crop + visione + testo) |
| POST | `/api/details/:id/generate/both` | **entrambe le tab in parallelo, UNA visione condivisa** |
| POST | `/api/artworks/:id/generate/overview` | testo presentazione |
| PATCH | `/api/artworks/:id` · `/api/details/:id/content/:tab` | correzioni utente |
| POST | `/api/artworks/:id/annotate` | (ri)genera l'immagine annotata da sola |
| POST | `/api/artworks/:id/approve` · `/publish` | approva (`ready`, annota) / esporta JSON |
| GET | `/api/artworks/:id/image` · `/image-annotated` | BLOB binari dal DB |
| DELETE | `/api/artworks/:id` | elimina opera + contenuti (cascade) |

`POST /publish` restituisce il JSON pronto da consumare in artest, con
`imageUrl` e `annotatedImageUrl`.

## Parallelizzazione LLM (limite contributor: 30 richieste/min)

Per ogni dettaglio le due tab condividono **una sola** chiamata di visione (il
prompt visivo non dipende dal livello) e poi generano i **due testi in
parallelo**: 5 dettagli passano da 20 chiamate a **15** (5 visione + 10 testo).
I dettagli vengono elaborati a ondate di **3 alla volta** (client) e tutte le
chiamate passano da un **rate limiter globale a finestra scorrevole di
26/min** dentro `../server.mjs` (`callModel`), con retry su HTTP 429:
sotto la soglia dei 30/min del piano contributor, mai 429.

Misurato sull'Annunciazione (10 tab): **~2,5 minuti** totali via UI, contro
~10 minuti con la vecchia generazione sequenziale (una tab alla volta).

### Dipendenza di sistema per l'immagine annotata

`annotate.py` richiede **Python 3 con Pillow** (e un font DejaVu su Linux;
fallback automatico al font di default di PIL). Se assente, il salvataggio
funziona comunque ma segnala `annotatedWarning`; si può rigenerare l'immagine
annotata in seguito con `POST /api/artworks/:id/annotate`.

## Verifica end-to-end effettuata (settembre 2026)

Flusso completo reale con l'immagine `annunciazione-beato-angelico.jpg`
(Annunciazione di Beato Angelico, San Marco): upload, riconoscimento metadati,
5 dettagli proposti, **tutte le 10 tab generate in parallelo (~2,5 min) con
chiamate reali e zero 429**, salvataggio con feedback positivo, generazione
automatica dell'**immagine annotata** verificata nel viewer (toggle pulita/
riquadri), BLOB serviti dal DB. La scheda demo è nel DB locale in stato
`ready` con entrambe le immagini memorizzate.
