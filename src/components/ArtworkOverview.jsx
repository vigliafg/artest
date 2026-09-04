const overviewCache = {};

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function ArtworkOverview({ artwork }) {
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const [collapsed, setCollapsed] = React.useState(false);
  const mounted = React.useRef(true);
  const cacheKey = artwork.id;

  function load() {
    setState({ status: 'loading', data: null, error: null });
    window.AnalysisService.overview(artwork, 'Scuola secondaria').then(function (result) {
      if (!mounted.current) return;
      overviewCache[cacheKey] = result;
      setState({ status: 'ready', data: result, error: null });
    }).catch(function (error) {
      if (!mounted.current) return;
      setState({ status: 'error', data: null, error: (error && error.message) || 'La presentazione non è disponibile.' });
    });
  }

  React.useEffect(function () {
    mounted.current = true;
    if (overviewCache[cacheKey]) {
      setState({ status: 'ready', data: overviewCache[cacheKey], error: null });
    } else {
      load();
    }
    return function () { mounted.current = false; };
  }, [cacheKey]);

  const data = state.data;
  const wordCount = data ? countWords(data.content.painting) + countWords(data.content.artist) : 0;

  return (
    <section className="overview-block" aria-label="Presentazione storico-artistica dell’opera e dell’artista">
      <div className="overview-head">
        <div className="overview-heading">
          <span className="eyebrow">Per iniziare</span>
          <h2>L’opera e il suo autore</h2>
        </div>
        {state.status === 'ready' && data && (
          <button className="overview-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? 'Mostra il contesto' : 'Nascondi il contesto'}
            <Icon name="chevron" size={15} />
          </button>
        )}
      </div>

      {state.status === 'loading' && (
        <div className="overview-card overview-loading" aria-live="polite">
          <div className="loading-orbit"><span></span><span></span><span></span></div>
          <h3>Sto preparando la presentazione…</h3>
          <p>Ricostruisco il contesto storico-artistico dell’opera e dell’artista. L’esplorazione resta disponibile qui sotto.</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="overview-card overview-error" aria-live="polite">
          <Icon name="info" size={22} />
          <h3>Presentazione non disponibile</h3>
          <p>{state.error}</p>
          <button className="secondary-button" onClick={load}>Riprova</button>
        </div>
      )}

      {state.status === 'ready' && data && !collapsed && (
        <div className="overview-card overview-ready">
          <div className="overview-grid">
            <div className="overview-col">
              <h3>Il dipinto</h3>
              <p>{data.content.painting}</p>
            </div>
            <div className="overview-col">
              <h3>L’artista</h3>
              <p>{data.content.artist}</p>
            </div>
          </div>
          <div className="overview-foot">
            <span className="overview-count">{wordCount} parole</span>
            <div className="overview-sources">
              {(data.sources || []).map(function (source) {
                return <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} <Icon name="external" size={11} /></a>;
              })}
            </div>
          </div>
          <p className="overview-disclaimer">{data.disclaimer}</p>
        </div>
      )}
    </section>
  );
}
