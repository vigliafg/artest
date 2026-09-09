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

function TypeSectionHead({ title, count }) {
  return (
    <div className="type-section-head">
      <div>
        <h3 className="type-title">{title}</h3>
        <p className="type-desc">{count === 1 ? 'Una scheda nella collezione' : count + ' schede nella collezione'}</p>
      </div>
      <span className="type-tag">{count}</span>
    </div>
  );
}

function CatalogPage({ cards, onOpen }) {
  const [query, setQuery] = React.useState('');
  const [type, setType] = React.useState('Tutte');
  const hero = (cards || [])[0] || null;
  const needle = query.toLowerCase();

  // Tre sezioni logiche della collezione, una per tipo di scheda.
  const sections = [
    {
      key: 'artwork', title: 'L’opera', filterKey: 'Dipinti',
      items: (cards || []).filter(function (card) { return !card.cardType || card.cardType === 'artwork'; }),
      render: function (card) { return <ArtworkCard key={card.id} artwork={card} onOpen={onOpen} />; }
    },
    {
      key: 'subject', title: 'Il soggetto', filterKey: 'Soggetti',
      items: (cards || []).filter(function (card) { return card.cardType === 'subject'; }),
      render: function (card) { return <SubjectCard key={card.id} card={card} onOpen={onOpen} />; }
    },
    {
      key: 'comparison', title: 'Il confronto', filterKey: 'Confronti',
      items: (cards || []).filter(function (card) { return card.cardType === 'comparison'; }),
      render: function (card) { return <ComparisonCard key={card.id} card={card} onOpen={onOpen} />; }
    }
  ];

  // Il filtro per tipo mostra/nasconde intere sezioni; la ricerca filtra dentro ciascuna.
  const visible = sections
    .filter(function (section) { return type === 'Tutte' || type === section.filterKey; })
    .map(function (section) {
      const items = section.items.filter(function (card) {
        const text = ((card.title || '') + ' ' + (card.artist || '') + ' ' + (card.period || '') + ' ' + (card.shortDesc || '')).toLowerCase();
        return text.includes(needle);
      });
      return { key: section.key, title: section.title, items: items, render: section.render };
    })
    .filter(function (section) { return section.items.length > 0; });
  const total = visible.reduce(function (sum, section) { return sum + section.items.length; }, 0);

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
        <div className="catalog-tools"><label className="search-field"><Icon name="search" size={18} /><span className="sr-only">Cerca nell’elenco</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca artista, opera o soggetto…" /></label></div>
        <div className="catalog-tabs" role="tablist" aria-label="Filtra la collezione per tipo">
          {[
            ['Tutte', (cards || []).length],
            ['Dipinti', sections[0].items.length],
            ['Soggetti', sections[1].items.length],
            ['Confronti', sections[2].items.length]
          ].map(function (tab) {
            return (
              <button key={tab[0]} type="button" role="tab" aria-selected={type === tab[0]} className={'catalog-tab' + (type === tab[0] ? ' active' : '')} onClick={() => setType(tab[0])}>
                {tab[0]}<span className="tab-count">{tab[1]}</span>
              </button>
            );
          })}
        </div>
        {visible.map(function (section) {
          return (
            <div className="type-section" key={section.key}>
              <TypeSectionHead title={section.title} count={section.items.length} />
              <div className="catalog-grid">{section.items.map(section.render)}</div>
            </div>
          );
        })}
        {total === 0 && <div className="catalog-empty"><Icon name="search" size={24} /><h3>Nessuna scheda trovata</h3><p>Prova a cambiare la ricerca o il filtro.</p></div>}
      </section>
    </main>
  );
}
