function SubjectCard({ card, onOpen }) {
  return (
    <button className="artwork-card subject-card" onClick={() => onOpen(card)} aria-label={'Apri ' + card.title}>
      <div className="card-image-wrap subject-card-fill">
        <div className="subject-card-inner">
          <span className="subject-ico">{String(card.name || 'S').charAt(0)}</span>
          <strong>{card.title}</strong>
          <small>{card.shortDesc || 'Il soggetto nella storia dell’arte'}</small>
        </div>
        <span className="card-arrow"><Icon name="arrow" size={18} /></span>
      </div>
      <div className="card-copy">
        <div className="eyebrow">{card.period}</div>
        <h3>{card.title}</h3>
        <p>Soggetto nella storia dell’arte</p>
      </div>
    </button>
  );
}

function ComparisonCard({ card, onOpen }) {
  return (
    <button className="artwork-card" onClick={() => onOpen(card)} aria-label={'Apri ' + card.title}>
      <div className="card-image-wrap">
        {card.image ? (
          <img src={card.image} alt={card.title} className="card-image" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.style.display = 'none'; }} />
        ) : (
          <div className="card-image-wrap comparison-fallback"><span className="subject-ico">⚖</span><strong>Faccia a faccia</strong></div>
        )}
        <span className="card-badge">Confronto</span>
        <span className="card-arrow"><Icon name="arrow" size={18} /></span>
      </div>
      <div className="card-copy">
        <div className="eyebrow">{card.period}</div>
        <h3>{card.title}</h3>
        <p>{card.comparisonType === 'same-artist' ? 'Stesso artista, fasi diverse' : 'Stesso soggetto, artisti diversi'}</p>
      </div>
    </button>
  );
}

function CatalogPage({ cards, onOpen }) {
  const [query, setQuery] = React.useState('');
  const [type, setType] = React.useState('Tutti');
  const artworks = (cards || []).filter(function (card) { return !card.cardType || card.cardType === 'artwork'; });
  const hero = artworks[0] || (cards || [])[0] || null;
  const types = ['Tutti', 'Dipinti', 'Soggetti', 'Confronti'];
  const filtered = (cards || []).filter(function (card) {
    const isSubject = card.cardType === 'subject';
    const isComparison = card.cardType === 'comparison';
    const matchesType = type === 'Tutti' || (type === 'Dipinti' && !card.cardType) || (type === 'Soggetti' && isSubject) || (type === 'Confronti' && isComparison);
    const text = ((card.title || '') + ' ' + (card.artist || '') + ' ' + (card.period || '') + ' ' + (card.shortDesc || '')).toLowerCase();
    return matchesType && text.includes(query.toLowerCase());
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
        {hero ? (
          <div className="hero-art">
            <div className="hero-frame"><img src={hero.image} alt={(hero.artist ? hero.artist + ', ' : '') + hero.title} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = hero.fallbackImage; }} /><span className="hero-spot hero-spot-one"></span><span className="hero-spot hero-spot-two"></span></div>
            <div className="hero-caption"><span>01</span><span>{hero.title} · {hero.artist || hero.period}</span></div>
          </div>
        ) : null}
        <div className="hero-scribble">guarda<br />più da vicino</div>
      </section>

      <section className="catalog-section" id="catalogo">
        <div className="section-heading"><div><span className="eyebrow">La collezione</span><h2>Inizia da un’opera.</h2></div><p>Schede didattiche: dipinti, soggetti nella storia dell’arte e confronti “faccia a faccia”.</p></div>
        <div className="catalog-tools"><label className="search-field"><Icon name="search" size={18} /><span className="sr-only">Cerca nell’elenco</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca artista, opera o soggetto…" /></label>
          <label className="filter-field"><span className="sr-only">Filtra per tipo</span><select value={type} onChange={(event) => setType(event.target.value)}>{types.map((item) => <option key={item}>{item}</option>)}</select><Icon name="chevron" size={16} /></label></div>
        <div className="catalog-grid">{filtered.map(function (card) {
          if (card.cardType === 'subject') return <SubjectCard key={card.id} card={card} onOpen={onOpen} />;
          if (card.cardType === 'comparison') return <ComparisonCard key={card.id} card={card} onOpen={onOpen} />;
          return <ArtworkCard key={card.id} artwork={card} onOpen={onOpen} />;
        })}</div>
        {filtered.length === 0 && <div className="catalog-empty"><Icon name="search" size={24} /><h3>Nessuna scheda trovata</h3><p>Prova a cambiare la ricerca o il filtro.</p></div>}
      </section>
    </main>
  );
}