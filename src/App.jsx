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
  const [activeArtwork, setActiveArtwork] = React.useState(null);
  const [configOpen, setConfigOpen] = React.useState(false);
  const artworks = window.APP_DATA.artworks;

  return (
    <div className="app-shell">
      {!activeArtwork && <header className="site-header"><a href="#top" className="brand" onClick={(event) => { event.preventDefault(); setActiveArtwork(null); }}><span className="brand-mark"><i></i><i></i><i></i></span><span>leggi l’<strong>opera</strong></span></a><nav><a href="#catalogo">La collezione</a><a href="#metodo">Come funziona</a></nav><div className="header-actions"><button className="config-button" onClick={() => setConfigOpen(true)}><Icon name="info" size={14} /> Configura chiave</button><span className="header-pill">Esperienza didattica <Icon name="sparkle" size={14} /></span></div></header>}
      {activeArtwork ? <ExplorePage artwork={activeArtwork} onBack={() => setActiveArtwork(null)} /> : <CatalogPage artworks={artworks} onOpen={setActiveArtwork} />}
      {!activeArtwork && <footer className="site-footer" id="metodo"><div className="footer-brand"><span className="brand-mark"><i></i><i></i><i></i></span><span>leggi l’<strong>opera</strong></span></div><p>Un invito a guardare con più attenzione.</p><div className="footer-meta"><span>Progetto educativo · 2026</span><span>Realizzato per imparare dall’arte</span></div></footer>}
      {configOpen && <KeyConfigModal onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
