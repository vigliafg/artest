function CatalogPage({ artworks, onOpen }) {
  const [query, setQuery] = React.useState('');
  const [period, setPeriod] = React.useState('Tutti i periodi');
  const periods = [...new Set(artworks.map((artwork) => artwork.period))];
  const filtered = artworks.filter(function (artwork) {
    var text = (artwork.title + ' ' + artwork.artist + ' ' + artwork.period).toLowerCase();
    return text.includes(query.toLowerCase()) && (period === 'Tutti i periodi' || artwork.period === period);
  });

  return (
    <main className="catalog-page">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="hero-kicker"><span></span> Un modo nuovo di guardare</div>
          <h1>Ogni dettaglio<br /><em>racconta</em> una storia.</h1>
          <p>Esplora le opere d’arte attraverso ciò che spesso passa inosservato. Clicca, osserva, fai domande.</p>
          <div className="hero-actions"><a href="#catalogo" className="primary-button">Inizia a esplorare <Icon name="arrow" size={18} /></a><span className="hero-note"><Icon name="sparkle" size={15} /> Guidato dall’intelligenza artificiale</span></div>
        </div>
        <div className="hero-art">
          <div className="hero-frame"><img src={artworks[0].image} alt="Dettaglio dell’Annunciazione del Beato Angelico" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = artworks[0].fallbackImage; }} /><span className="hero-spot hero-spot-one"></span><span className="hero-spot hero-spot-two"></span></div>
          <div className="hero-caption"><span>01</span><span>Annunciazione · Beato Angelico</span></div>
        </div>
        <div className="hero-scribble">guarda<br />più da vicino</div>
      </section>

      <section className="catalog-section" id="catalogo">
        <div className="section-heading"><div><span className="eyebrow">La collezione</span><h2>Inizia da un’opera.</h2></div><p>Una selezione di capolavori per allenare lo sguardo e scoprire nuove connessioni.</p></div>
        <div className="catalog-tools"><label className="search-field"><Icon name="search" size={18} /><span className="sr-only">Cerca nell’elenco delle opere</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca artista o opera…" /></label><label className="filter-field"><span className="sr-only">Filtra per periodo</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option>Tutti i periodi</option>{periods.map((item) => <option key={item}>{item}</option>)}</select><Icon name="chevron" size={16} /></label></div>
        <div className="catalog-grid">{filtered.map((artwork) => <ArtworkCard key={artwork.id} artwork={artwork} onOpen={onOpen} />)}</div>
        {filtered.length === 0 && <div className="catalog-empty"><Icon name="search" size={24} /><h3>Nessuna opera trovata</h3><p>Prova a cambiare la ricerca o a rimuovere il filtro.</p></div>}
      </section>
    </main>
  );
}
