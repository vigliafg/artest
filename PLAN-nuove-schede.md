# PIANO — Due nuovi tipi di scheda in artest-creator (+ viewer artest)

*Documento di pianificazione. Stato: **approvato, in implementazione** · 07/09/2026*

## 1. Contesto

artest-creator oggi crea un solo tipo di scheda: il **singolo dipinto** (metadati + presentazione a 2 sezioni + N dettagli ciascuno con 2 tab × 4–5 sezioni + 10 opere simili con immagini, salvato in SQLite come `ready`). Il viewer **artest** legge in sola lettura le schede `ready` e le presenta in libreria e in una vista esplorativa.

Si aggiungono due nuovi tipi di scheda:

| Tipo | Scopo | Input utente |
|---|---|---|
| **A · Soggetto nella storia dell'arte** | Come lo stesso soggetto (Annunciazione, Natività, battaglie navali…) è stato dipinto da artisti diversi attraverso i secoli | Solo il **nome del soggetto** |
| **B · Faccia a faccia** | Confronto critico di due opere: stesso soggetto/tra due artisti, oppure stesso artista in due fasi della vita | Scelta delle **due opere** + tipo di confronto |

## 2. Decisioni confermate

1. **Faccia a faccia**: i due lati possono essere opere dal DB di artest-creator **oppure** esterne (URL Wikimedia / upload) → ogni lato ha `source = library | external`.
2. **Soggetto**: le opere rappresentative dell'evoluzione hanno **immagini scaricate** (meccanismo collaudato di `similar_works`).
3. **Viewer artest**: integrazione **completa** (libreria con i 3 tipi di miniatura + viste dedicate).
4. **Confronto**: le voci "Punti in comune / Differenze" sono **solo testuali** (nessun riferimento agli hotspot).

## 3. Struttura attuale della scheda singolo dipinto (riepilogo)

- **DB**: 7 tabelle — `artworks` (metadati + BLOB pulita/annotata), `overview` (Il dipinto, L'artista), `details` (hotspot con regione normalizzata), `detail_content` (per coppia dettaglio+tab: *Studio* = Cosa vedi / Cosa significa / In relazione all'opera; *Approfondimento* = Una curiosità / Confronti / Questioni aperte / Tecnica e materia; + *Guarda ancora*), `similar_works` (10 opere stesso soggetto con BLOB), `sources`, `sqlite_sequence`.
- **Pipeline 5 passi**: upload → riconoscimento metadati → proposta dettagli + generazione tab → presentazione + opere simili → salva/approva (`ready`).
- **Viewer**: `/api/library` (solo `ready`) + `/api/artworks/:id` (payload completo), immagini BLOB, viste React (CatalogPage, ExplorePage, ArtworkViewer con spotlight, ArtworkOverview con carosello opere simili).

## 4. Schema DB — nuove tabelle (nessuna modifica alle esistenti)

```sql
-- Scheda A: Soggetto nella storia dell'arte
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,               -- slug del nome (es. 'annunciazione')
  name TEXT NOT NULL,
  short_desc TEXT NOT NULL DEFAULT '',       -- 1-2 frasi per miniatura/card
  intro TEXT NOT NULL DEFAULT '',            -- Sez.1 Introduzione
  origins TEXT NOT NULL DEFAULT '',          -- Sez.2 Origini e fonti iconografiche
  symbols TEXT NOT NULL DEFAULT '',          -- Sez.5 JSON [{simbolo, significato}]
  interpretations TEXT NOT NULL DEFAULT '',  -- Sez.6 Interpretazioni e varianti
  curiosities TEXT NOT NULL DEFAULT '',      -- Sez.7 Curiosità e questioni aperte
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE subject_chapters (              -- Sez.3 Evoluzione per epoche
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  era TEXT NOT NULL,                         -- titolo capitolo
  text TEXT NOT NULL DEFAULT ''
);
CREATE TABLE subject_works (                 -- Sez.4 Opere rappresentative (clone similar_works)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '', museum TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
  image_page TEXT NOT NULL DEFAULT '', image_data BLOB, image_mime TEXT NOT NULL DEFAULT 'image/jpeg',
  image_status TEXT NOT NULL DEFAULT 'missing', status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT, updated_at TEXT
);

-- Scheda B: Faccia a faccia
CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  comparison_type TEXT NOT NULL DEFAULT 'same-subject' CHECK (comparison_type IN ('same-subject','same-artist')),
  intro TEXT NOT NULL DEFAULT '',            -- Sez.1 Introduzione al confronto
  technique TEXT NOT NULL DEFAULT '',        -- Sez.5 Tecnica a confronto
  context TEXT NOT NULL DEFAULT '',          -- Sez.6 Contesto storico-artistico
  critique TEXT NOT NULL DEFAULT '',         -- Sez.7 Interpretazione critica
  curiosities TEXT NOT NULL DEFAULT '',      -- Sez.8 Curiosità
  thumb_data BLOB, thumb_mime TEXT NOT NULL DEFAULT 'image/jpeg',  -- composita PIL
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE comparison_sides (              -- Sez.2 Le due opere
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('a','b')),
  source TEXT NOT NULL CHECK (source IN ('library','external')),
  artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL,   -- se library
  title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '', museum TEXT NOT NULL DEFAULT '',
  image_data BLOB, image_mime TEXT NOT NULL DEFAULT 'image/jpeg',  -- se external/upload
  image_url TEXT NOT NULL DEFAULT '', image_status TEXT NOT NULL DEFAULT 'missing',
  created_at TEXT, updated_at TEXT,
  UNIQUE(comparison_id, side)
);
CREATE TABLE comparison_points (             -- Sez.3-4 Punti in comune / Differenze
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('similar','different')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT ''
);
```

**Miniatura composita** (metà sinistra di A + metà destra di B): generata via PIL alla **approvazione** (nuovo script `compose_thumb.py`, pattern di `annotate.py`) e salvata in `comparisons.thumb_data`; il viewer la serve come BLOB.

## 5. API artest-creator (rotte nuove in `artest-creator/server.mjs`)

**Subjects**
- `POST /api/subjects {name}` → crea draft (slug id)
- `POST /api/subjects/:id/generate/intro` → intro + origins + short_desc
- `POST /api/subjects/:id/generate/chapters` → 5–7 capitoli (era + testo)
- `POST /api/subjects/:id/generate/works` → 6–10 opere + download immagini (riuso `normalizeSimilar`/`resolveSimilarImages`)
- `POST /api/subjects/:id/generate/closing` → symbols + interpretations + curiosities
- `GET /api/subjects` · `GET /api/subjects/:id` (payload completo con capitoli+opere)
- `PATCH /api/subjects/:id` (revisione sezioni, nome, capitoli/opere come array)
- `DELETE /api/subjects/:id` · `POST /api/subjects/:id/approve` → `ready`

**Comparisons**
- `POST /api/comparisons {title?, comparison_type}` → draft
- `POST /api/comparisons/:id/sides {a:{...}, b:{...}}` → lato `library` (solo `artwork_id`) oppure `external` (titolo/artista/data/museo + `imageDataUrl` da upload oppure `imageUrl` con download)
- `POST /api/comparisons/:id/generate/intro` · `.../points` (elenchi similar/different) · `.../analysis` (technique+context+critique+curiosities)
- `GET/PATCH/DELETE /api/comparisons[/:id]` · `POST /api/comparisons/:id/approve` (compose_thumb + ready)
- Immagini lato: `library` → `GET /api/artworks/:id/image`; `external` → `GET /api/comparisons/:id/side/:side/image` (BLOB di comparison_sides)

## 6. Scheda tipo A — "Soggetto nella storia dell'arte" (modello)

Generata dal modello a partire **solo dal nome**. Esempio: *Annunciazione*.

| # | Sezione | Tipo contenuto | Esempio |
|---|---|---|---|
| 1 | Introduzione al soggetto | testo lungo | "L'Annunciazione è il racconto dell'angelo Gabriele che annuncia a Maria la nascita di Cristo…" |
| 2 | Origini e fonti iconografiche | testo lungo | "Dal Vangelo di Luca (1,26-38); prime raffigurazioni paleocristiane nei sarcofagi, schema bizantino angelo a sinistra / Maria a destra…" |
| 3 | L'evoluzione per epoche | elenco ordinato di capitoli (era + testo) | • *Medioevo*: fondo oro, Maria regina… • *Rinascimento fiorentino*: prospettiva, Fra Angelico a San Marco… • *Manierismo*: eleganza… • *Barocco*: luce teatrale… • *Novecento*: riletture simboliste… |
| 4 | Opere rappresentative | galleria 6–10 con BLOB immagine | Fra Angelico (1438–45, San Marco) · Simone Martini (1333, Uffizi) · Leonardo (1472, Uffizi)… con didascalia "perché è importante per questo soggetto" |
| 5 | Attributi e simboli ricorrenti | elenco simbolo→significato | Giglio → purezza · colonna → fede · luce → Spirito Santo · libro aperto → Scritture |
| 6 | Interpretazioni e varianti | testo lungo | "Da dogma teologico a esercizio di prospettiva; versione fiamminga domestica vs italiana monumentale…" |
| 7 | Curiosità e questioni aperte | testo lungo | "Il dibattito sull'angelo annunziante di Antonello da Messina…" |

**Miniatura in home**: card testuale con il nome del soggetto (stile biglietto "S · Annunciazione").

## 7. Scheda tipo B — "Faccia a faccia" (modello)

Input: due opere (A e B) + tipo. Esempio: *Fra Angelico vs Leonardo (stesso soggetto)*.

| # | Sezione | Tipo contenuto | Esempio |
|---|---|---|---|
| 1 | Introduzione al confronto | testo lungo | "A 40 anni di distanza, due letture opposte dello stesso mistero: la luce spirituale di San Marco contro il mistero del giardino di Leonardo…" |
| 2 | Le due opere | due schede affiancate (immagine + metadati) | A: Annunciazione, Fra Angelico, 1438–45, affresco, San Marco · B: Annunciazione, Leonardo, 1472, tempera/olio, Uffizi |
| 3 | Punti in comune | elenco strutturato (titolo + testo) | "L'angelo a sinistra e Maria a destra; l'hortus conclusus…" |
| 4 | Differenze | elenco strutturato (titolo + testo) | "Oro e luce piatta vs sfumato e ombra; cortile chiuso vs palazzo aperto…" |
| 5 | Tecnica a confronto | testo lungo | "Affresco su muro vs tempera su tavola; prospettiva semplice vs prospettiva aerea…" |
| 6 | Contesto storico-artistico | testo lungo | "Firenze tardogotico-rinascimentale vs corte sforzesca…" |
| 7 | Interpretazione critica | testo lungo | "Dalla catechesi alla psicologia del mistero…" |
| 8 | Curiosità | testo lungo | "La mano alzata di Maria compare identica in entrambe…" |

**Miniatura in home**: composita (metà A + metà B) generata dal server.

## 8. UI artest-creator (`public/index.html`)

- **Home**: tre sezioni/filtri — card dipinto (miniatura), card soggetto (testuale col nome), card faccia a faccia (composita); bottoni "+ Nuova opera", "+ Nuovo soggetto", "+ Nuovo confronto"; badge di stato come oggi.
- **SubjectStudio**: inserisci nome → pipeline sequenziale con barra progresso e feedback per step (outline → capitoli → opere → chiusura) → editor per sezione (capitoli e opere come righe editabili, pattern `sim-grid`) → "💾 Salva nel database" → `ready`.
- **ComparisonStudio**: passo 1 scelta A/B (dal DB oppure upload/URL con anteprima e metadati) → passo 2 tipo confronto + pipeline (intro → punti → analisi) → passo 3 editor sezioni (elenchi punti editabili) → passo 4 "💾 Salva nel database" (genera composita + ready).
- Riuso: `pipelineCardHtml`/`pipeStart`, upload+crop, editor textarea, pattern pannelli; renderer `render()` esteso con le nuove viste; viewer interno "Vedi" per i tipi pronti.

## 9. Viewer artest (integrazione completa)

- **`server.mjs` (artest)**: `/api/library` → `[{cardType:'artwork'|'subject'|'comparison', ...}]` (artwork = miniatura attuale; subject = nome testuale; comparison = `thumbUrl`). Nuove rotte read-only: `GET /api/subjects/:id`, `GET /api/comparisons/:id`, `GET /api/comparisons/:id/thumb`, `GET /api/comparisons/:id/side/:s/image`. Nuovi accessor RO in `artest-creator/db.mjs` (pattern `openReadonly`, nessuna scrittura).
- **React**: `SubjectView.jsx` (intro/origini, **timeline verticale** dei capitoli, galleria opere con BLOB, elenco simboli, interpretazioni, curiosità, comandi A+/A− come oggi) e `ComparisonView.jsx` (intro, due schede affiancate con immagini, elenchi "Punti in comune"/"Differenze" distinti, tecnica, contesto, critica, curiosità).
- **`CatalogPage.jsx` / `App.jsx`**: gestione dei 3 tipi di card in griglia e hero; routing per le nuove viste.

## 10. Test e verifica

- Unit test nuovi su CRUD/accessor (db.mjs) e integrazione rotte (test_server.mjs); suite esistente resta verde (27/27+).
- Verifica live step-by-step: soggetto reale **"Annunciazione"** (pipeline → ready, capitoli e opere con immagini) e confronto reale **Fra Angelico vs Leonardo** (lato library + lato URL) → preview artest-creator 8100 e artest 8000, console pulita.
- Aggiornamento `README.md` e run doc; **commit e push** a fine lavoro.

## 11. Ordine di esecuzione

1. **Fase A — DB**: 6 tabelle + CRUD/approve + accessor RO → test
2. **Fase B — API**: rotte subjects + comparisons (incl. `compose_thumb.py`) → test di integrazione
3. **Fase C — UI artest-creator**: home a 3 tipi, SubjectStudio, ComparisonStudio → E2E su 8100
4. **Fase D — Viewer artest**: library multi-tipo, rotte read-only, SubjectView/ComparisonView → E2E su 8000
5. **Fase E — Rifiniture**: README, run doc, suite completa, commit + push

## 12. Note aperte / possibilità future

- Le voci di confronto potranno in futuro riferirsi ai dettagli (hotspot) delle due opere (deciso: non ora).
- I capitoli dell'evoluzione potranno avere immagini di dettaglio dedicate in futuro.
- La galleria opere del Soggetto riusa il motore download di `similar_works` (pacing 150 ms tra i download).