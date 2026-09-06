function KeyConfigModal({ onClose }) {
  const [status, setStatus] = React.useState('checking');
  const command = 'python setup_nvidia_key.py';

  React.useEffect(() => {
    fetch('/api/status')
      .then((response) => response.json())
      .then((data) => setStatus(data.configured ? 'configured' : 'missing'))
      .catch(() => setStatus('unknown'));
  }, []);

  function copyCommand() {
    navigator.clipboard?.writeText(command);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="config-modal" role="dialog" aria-modal="true" aria-labelledby="config-title">
        <button className="modal-close" onClick={onClose} aria-label="Chiudi configurazione"><Icon name="close" size={18} /></button>
        <span className="ai-mark"><Icon name="sparkle" size={15} /> CONFIGURAZIONE SICURA</span>
        <h2 id="config-title">Collega l’analisi AI</h2>
        <p>La chiave non viene inserita nella pagina web. Usa il configuratore Tkinter per salvarla nell’ambiente utente di Windows.</p>
        <div className={'config-status ' + status}><span></span>{status === 'configured' ? 'Chiave configurata' : status === 'missing' ? 'Chiave non ancora configurata' : status === 'checking' ? 'Controllo in corso…' : 'Stato non disponibile'}</div>
        <div className="command-box"><code>{command}</code><button onClick={copyCommand}>Copia</button></div>
        <ol><li>Avvia il comando in PowerShell.</li><li>Inserisci la chiave e premi <strong>Salva chiave</strong>.</li><li>Riapri il terminale e riavvia <code>node server.mjs</code>.</li></ol>
        <button className="secondary-button modal-action" onClick={onClose}>Ho capito</button>
      </section>
    </div>
  );
}

function App() {
  const [activeArtwork, setActiveArtwork] = React.useState(null);   // scheda completa (payload /api/artworks/:id)
  const [activeCard, setActiveCard] = React.useState(null);          // card selezionata in catalogo (per lo stato di caricamento)
  const [configOpen, setConfigOpen] = React.useState(false);
  const [artworks, setArtworks] = React.useState(null);
  const [libraryStatus, setLibraryStatus] = React.useState('loading');
  const [openingId, setOpeningId] = React.useState(null);
  const [openError, setOpenError] = React.useState(null);

  // La collezione arriva dal DB di art-creator (opere pubblicate, stato "ready").
  // Se non ci sono schede pubblicate (o il DB non è raggiungibile) si usa la
  // demo inclusa nella pagina, così l'app resta sempre navigabile.
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/library')
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        const list = (payload && Array.isArray(payload.artworks) && payload.artworks.length)
          ? payload.artworks
          : (window.APP_DATA && window.APP_DATA.artworks ? window.APP_DATA.artworks : []);
        setArtworks(list);
        setLibraryStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setArtworks(window.APP_DATA && window.APP_DATA.artworks ? window.APP_DATA.artworks : []);
        setLibraryStatus('ready');
      });
    return function () { cancelled = true; };
  }, []);

  // All'apertura di una card del catalogo carichiamo la scheda COMPLETA dal server
  // (immagini BLOB, dettagli con i testi, presentazione, opere simili). Se l'opera è
  // la demo offline (nessuna rotta /api/artworks/:id), usiamo direttamente i suoi dati.
  function openArtwork(card) {
    setActiveCard(card);
    setOpenError(null);
    setActiveArtwork(null);
    setOpeningId(card.id);
    const demo = (window.APP_DATA && window.APP_DATA.artworks || []).find(a => a.id === card.id);
    if (demo && !card.source) {
      setOpeningId(null);
      setActiveArtwork(demo);
      return;
    }
    fetch('/api/artworks/' + encodeURIComponent(card.id))
      .then((response) => {
        if (!response.ok) throw new Error('Scheda non disponibile (HTTP ' + response.status + ')');
        return response.json();
      })
      .then((payload) => {
        setOpeningId(null);
        setActiveArtwork(payload);
      })
      .catch((error) => {
        setOpeningId(null);
        setOpenError((error && error.message) || 'Impossibile caricare la scheda.');
      });
  }

  function backHome() {
    setActiveArtwork(null);
    setActiveCard(null);
    setOpenError(null);
  }

  const showCatalog = !activeArtwork && !openingId;

  return (
    <div className="app-shell">
      {showCatalog && <header className="site-header"><a href="#top" className="brand" onClick={(event) => { event.preventDefault(); backHome(); }}><span className="brand-mark"><i></i><i></i><i></i></span><span>leggi l’<strong>opera</strong></span></a><nav><a href="#catalogo">La collezione</a><a href="#metodo">Come funziona</a></nav><div className="header-actions"><button className="config-button" onClick={() => setConfigOpen(true)}><Icon name="info" size={14} /> Configura chiave</button><span className="header-pill">Esperienza didattica <Icon name="sparkle" size={14} /></span></div></header>}
      {showCatalog && libraryStatus === 'loading' && (
        <main className="catalog-page"><section className="catalog-section" style={{ textAlign: 'center', paddingTop: 120 }}><div className="loading-orbit" style={{ margin: '0 auto 22px' }}><span></span><span></span><span></span></div><h2 style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Carico la collezione…</h2></section></main>
      )}
      {showCatalog && libraryStatus === 'ready' && artworks && <CatalogPage artworks={artworks} onOpen={openArtwork} />}
      {openingId && !activeArtwork && (
        <main className="explore-page"><section className="exploration-layout" style={{ paddingTop: 60 }}>
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '70px 20px' }}>
            <div className="loading-orbit" style={{ margin: '0 auto 22px' }}><span></span><span></span><span></span></div>
            <h2 style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Carico la scheda didattica…</h2>
          </div>
        </section></main>
      )}
      {openError && !activeArtwork && (
        <main className="explore-page"><section className="exploration-layout" style={{ paddingTop: 60 }}>
          <div className="overview-card overview-error" style={{ gridColumn: '1 / -1' }}>
            <Icon name="info" size={22} />
            <h3>Impossibile aprire la scheda</h3>
            <p>{openError}</p>
            <button className="secondary-button" onClick={backHome}>Torna alla collezione</button>
          </div>
        </section></main>
      )}
      {activeArtwork && <ExplorePage artwork={activeArtwork} onBack={backHome} />}
      {showCatalog && <footer className="site-footer" id="metodo"><div className="footer-brand"><span className="brand-mark"><i></i><i></i><i></i></span><span>leggi l’<strong>opera</strong></span></div><p>Un invito a guardare con più attenzione.</p><div className="footer-meta"><span>Progetto educativo · 2026</span><span>Realizzato per imparare dall’arte</span></div></footer>}
      {configOpen && <KeyConfigModal onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
