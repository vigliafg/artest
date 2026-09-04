// art-creator — storage layer (SQLite nativo node:sqlite, zero dipendenze)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(ROOT, 'data');
export const UPLOAD_DIR = join(ROOT, 'uploads');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_PATH = process.env.ART_CREATOR_DB || join(DATA_DIR, 'art-creator.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artworks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      period TEXT NOT NULL DEFAULT '',
      technique TEXT NOT NULL DEFAULT '',
      institution TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL,
      image_width INTEGER NOT NULL DEFAULT 0,
      image_height INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft'
    );

    CREATE TABLE IF NOT EXISTS detail_content (
      detail_id INTEGER NOT NULL REFERENCES details(id) ON DELETE CASCADE,
      tab TEXT NOT NULL CHECK (tab IN ('studio', 'approfondimento')),
      observation TEXT NOT NULL DEFAULT '',
      meaning TEXT NOT NULL DEFAULT '',
      relation TEXT NOT NULL DEFAULT '',
      curiosity TEXT NOT NULL DEFAULT '',
      comparisons TEXT NOT NULL DEFAULT '',
      open_questions TEXT NOT NULL DEFAULT '',
      look_again TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      model TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (detail_id, tab)
    );

    CREATE TABLE IF NOT EXISTS overview (
      artwork_id TEXT PRIMARY KEY REFERENCES artworks(id) ON DELETE CASCADE,
      painting TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      model TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      detail_id INTEGER REFERENCES details(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_details_artwork ON details(artwork_id);
    CREATE INDEX IF NOT EXISTS idx_content_detail ON detail_content(detail_id);
    CREATE INDEX IF NOT EXISTS idx_sources_artwork ON sources(artwork_id);
  `);

  // migrazione: le immagini vivono nel DB come BLOB (binary, non base64: più compatto e veloce).
  // Il file in uploads/ resta come scratch per PIL (crop/annotazione) e come fallback.
  const cols = db.prepare('PRAGMA table_info(artworks)').all().map(c => c.name);
  if (!cols.includes('image_data')) db.exec('ALTER TABLE artworks ADD COLUMN image_data BLOB');
  if (!cols.includes('image_mime')) db.exec("ALTER TABLE artworks ADD COLUMN image_mime TEXT NOT NULL DEFAULT 'image/jpeg'");
  if (!cols.includes('annotated_data')) db.exec('ALTER TABLE artworks ADD COLUMN annotated_data BLOB');
  if (!cols.includes('annotated_mime')) db.exec("ALTER TABLE artworks ADD COLUMN annotated_mime TEXT NOT NULL DEFAULT 'image/jpeg'");

  // backfill: opere esistenti (solo file su disco) -> carica il BLOB una tantum
  const missing = db.prepare("SELECT id, image_path FROM artworks WHERE image_data IS NULL AND image_path != ''").all();
  for (const row of missing) {
    const filePath = join(ROOT, row.image_path);
    if (existsSync(filePath)) {
      const buf = readFileSync(filePath);
      const mime = buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : 'image/jpeg';
      db.prepare('UPDATE artworks SET image_data = ?, image_mime = ? WHERE id = ?').run(buf, mime, row.id);
    }
  }
}

function now() { return new Date().toISOString(); }

function rowToArtwork(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    date: row.date,
    period: row.period,
    technique: row.technique,
    institution: row.institution,
    location: row.location,
    imagePath: row.image_path,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    hasImage: row.image_data != null,
    hasAnnotated: row.annotated_data != null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createArtwork({ id, title, artist, date, period, technique, institution, location, imagePath, imageWidth = 0, imageHeight = 0, imageData = null, imageMime = 'image/jpeg' }) {
  db.prepare(`INSERT INTO artworks (id, title, artist, date, period, technique, institution, location, image_path, image_data, image_mime, image_width, image_height, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
    .run(id, title || '', artist || '', date || '', period || '', technique || '', institution || '', location || '', imagePath, imageData, imageMime, imageWidth, imageHeight, now(), now());
  return getArtwork(id);
}

export function getArtwork(id) {
  return rowToArtwork(db.prepare('SELECT * FROM artworks WHERE id = ?').get(id));
}

export function listArtworks() {
  return db.prepare('SELECT * FROM artworks ORDER BY created_at DESC').all().map(rowToArtwork);
}

export function updateArtwork(id, patch) {
  const current = getArtwork(id);
  if (!current) return null;
  const merged = {
    title: patch.title ?? current.title,
    artist: patch.artist ?? current.artist,
    date: patch.date ?? current.date,
    period: patch.period ?? current.period,
    technique: patch.technique ?? current.technique,
    institution: patch.institution ?? current.institution,
    location: patch.location ?? current.location,
    status: patch.status ?? current.status
  };
  db.prepare(`UPDATE artworks SET title=?, artist=?, date=?, period=?, technique=?, institution=?, location=?, status=?, updated_at=? WHERE id=?`)
    .run(merged.title, merged.artist, merged.date, merged.period, merged.technique, merged.institution, merged.location, merged.status, now(), id);
  return getArtwork(id);
}

export function deleteArtwork(id) {
  db.prepare('DELETE FROM artworks WHERE id = ?').run(id);
}

// --- immagini BLOB (pulita + annotata) ---
export function getArtworkImageData(id) {
  const row = db.prepare('SELECT image_data, image_mime, annotated_data, annotated_mime FROM artworks WHERE id = ?').get(id);
  if (!row) return null;
  return {
    clean: row.image_data ? { data: row.image_data, mime: row.image_mime || 'image/jpeg' } : null,
    annotated: row.annotated_data ? { data: row.annotated_data, mime: row.annotated_mime || 'image/jpeg' } : null
  };
}
export function setAnnotatedImage(id, data, mime = 'image/jpeg') {
  db.prepare('UPDATE artworks SET annotated_data = ?, annotated_mime = ?, updated_at = ? WHERE id = ?').run(data, mime, now(), id);
}
export function setArtworkImageData(id, data, mime = 'image/jpeg') {
  db.prepare('UPDATE artworks SET image_data = ?, image_mime = ?, updated_at = ? WHERE id = ?').run(data, mime, now(), id);
}

// --- dettagli (hotspot) ---
export function addDetail(artworkId, { title, category, x, y, width, height, sortOrder = 0 }) {
  const result = db.prepare(`INSERT INTO details (artwork_id, title, category, x, y, width, height, sort_order)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(artworkId, title, category || '', x, y, width, height, sortOrder);
  return getDetail(result.lastInsertRowid);
}

export function getDetail(detailId) {
  const row = db.prepare('SELECT * FROM details WHERE id = ?').get(detailId);
  if (!row) return null;
  return {
    id: row.id,
    artworkId: row.artwork_id,
    title: row.title,
    category: row.category,
    region: { x: row.x, y: row.y, width: row.width, height: row.height },
    sortOrder: row.sort_order,
    status: row.status
  };
}

export function listDetails(artworkId) {
  return db.prepare('SELECT * FROM details WHERE artwork_id = ? ORDER BY sort_order, id').all(artworkId)
    .map(row => ({
      id: row.id,
      artworkId: row.artwork_id,
      title: row.title,
      category: row.category,
      region: { x: row.x, y: row.y, width: row.width, height: row.height },
      sortOrder: row.sort_order,
      status: row.status
    }));
}

export function replaceDetails(artworkId, items) {
  db.prepare('DELETE FROM details WHERE artwork_id = ?').run(artworkId);
  return items.map((item, index) => {
    const region = item.region || {};
    return addDetail(artworkId, {
      title: item.title,
      category: item.category,
      x: item.x ?? region.x,
      y: item.y ?? region.y,
      width: item.width ?? region.width,
      height: item.height ?? region.height,
      sortOrder: index
    });
  });
}

export function updateDetail(detailId, patch) {
  const fields = ['title', 'category', 'x', 'y', 'width', 'height'];
  const sets = [];
  const values = [];
  for (const field of fields) {
    if (patch[field] !== undefined) {
      if (field === 'title' || field === 'category') { sets.push(`${field}=?`); values.push(patch[field]); }
      else { sets.push(`${field}=?`); values.push(Number(patch[field])); }
    }
  }
  if (sets.length) { values.push(detailId); db.prepare(`UPDATE details SET ${sets.join(', ')} WHERE id=?`).run(...values); }
  return getDetail(detailId);
}

// --- contenuto per dettaglio e tab ---
export function saveDetailContent(detailId, tab, content, meta = {}) {
  db.prepare(`INSERT INTO detail_content (detail_id, tab, observation, meaning, relation, curiosity, comparisons, open_questions, look_again, status, model, prompt_version, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(detail_id, tab) DO UPDATE SET
                observation=excluded.observation, meaning=excluded.meaning, relation=excluded.relation,
                curiosity=excluded.curiosity, comparisons=excluded.comparisons, open_questions=excluded.open_questions,
                look_again=excluded.look_again, status=excluded.status, model=excluded.model,
                prompt_version=excluded.prompt_version, updated_at=excluded.updated_at`)
    .run(detailId, tab, content.observation || '', content.meaning || '', content.relation || '',
         content.curiosity || '', content.comparisons || '', content.openQuestions || '',
         content.lookAgain || '', meta.status || 'generated', meta.model || '', meta.promptVersion || '', now());
}

export function getDetailContent(detailId, tab) {
  const row = db.prepare('SELECT * FROM detail_content WHERE detail_id = ? AND tab = ?').get(detailId, tab);
  if (!row) return null;
  return {
    detailId: row.detail_id,
    tab: row.tab,
    content: {
      observation: row.observation,
      meaning: row.meaning,
      relation: row.relation,
      curiosity: row.curiosity,
      comparisons: row.comparisons,
      openQuestions: row.open_questions,
      lookAgain: row.look_again
    },
    status: row.status,
    model: row.model,
    promptVersion: row.prompt_version,
    updatedAt: row.updated_at
  };
}

// --- overview ---
export function saveOverview(artworkId, { painting, artist }, meta = {}) {
  db.prepare(`INSERT INTO overview (artwork_id, painting, artist, status, model, prompt_version, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(artwork_id) DO UPDATE SET
                painting=excluded.painting, artist=excluded.artist, status=excluded.status,
                model=excluded.model, prompt_version=excluded.prompt_version, updated_at=excluded.updated_at`)
    .run(artworkId, painting || '', artist || '', meta.status || 'generated', meta.model || '', meta.promptVersion || '', now());
}

export function getOverview(artworkId) {
  const row = db.prepare('SELECT * FROM overview WHERE artwork_id = ?').get(artworkId);
  if (!row) return null;
  return { artworkId: row.artwork_id, painting: row.painting, artist: row.artist, status: row.status, updatedAt: row.updated_at };
}

// --- fonti ---
export function addSource({ artworkId, detailId = null, title, url, type }) {
  const result = db.prepare('INSERT INTO sources (artwork_id, detail_id, title, url, type) VALUES (?, ?, ?, ?, ?)')
    .run(artworkId, detailId, title || '', url || '', type || '');
  return result.lastInsertRowid;
}

export function listSources(artworkId) {
  return db.prepare('SELECT * FROM sources WHERE artwork_id = ? ORDER BY detail_id IS NOT NULL, id').all(artworkId)
    .map(row => ({ id: row.id, detailId: row.detail_id, title: row.title, url: row.url, type: row.type }));
}

// --- lettura completa (per viewer / publish) ---
export function getFullArtwork(id) {
  const artwork = getArtwork(id);
  if (!artwork) return null;
  const overview = getOverview(id);
  const details = listDetails(id).map(detail => {
    const studio = getDetailContent(detail.id, 'studio');
    const approfondimento = getDetailContent(detail.id, 'approfondimento');
    return { ...detail, tabs: { studio, approfondimento } };
  });
  return { ...artwork, overview, details, sources: listSources(id) };
}

export function countStatus() {
  return {
    artworks: db.prepare('SELECT COUNT(*) AS c FROM artworks').get().c,
    ready: db.prepare("SELECT COUNT(*) AS c FROM artworks WHERE status = 'ready'").get().c,
    generated: db.prepare("SELECT COUNT(*) AS c FROM artworks WHERE status = 'generated'").get().c
  };
}

// --- approvazione e publish ---
export function approveArtwork(id) {
  const artwork = getArtwork(id);
  if (!artwork) return null;
  db.prepare("UPDATE detail_content SET status = 'approved' WHERE detail_id IN (SELECT id FROM details WHERE artwork_id = ?)").run(id);
  db.prepare("UPDATE overview SET status = 'approved' WHERE artwork_id = ?").run(id);
  updateArtwork(id, { status: 'ready' });
  return getFullArtwork(id);
}

export function publishArtwork(id) {
  const full = getFullArtwork(id);
  if (!full || full.status !== 'ready') return null;
  return {
    id: full.id,
    title: full.title,
    artist: full.artist,
    date: full.date,
    period: full.period,
    technique: full.technique,
    institution: full.institution,
    location: full.location,
    imageUrl: '/api/artworks/' + full.id + '/image',
    annotatedImageUrl: full.hasAnnotated ? '/api/artworks/' + full.id + '/image-annotated' : null,
    status: full.status,
    publishedAt: new Date().toISOString(),
    overview: full.overview
      ? { painting: full.overview.painting, artist: full.overview.artist }
      : null,
    details: full.details.map(detail => ({
      id: detail.id,
      title: detail.title,
      category: detail.category,
      region: detail.region,
      tabs: {
        studio: detail.tabs.studio ? detail.tabs.studio.content : null,
        approfondimento: detail.tabs.approfondimento ? detail.tabs.approfondimento.content : null
      }
    })),
    sources: full.sources.map(s => ({ title: s.title, url: s.url, type: s.type }))
  };
}
