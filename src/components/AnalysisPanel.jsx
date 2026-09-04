var LEVELS = ['Scuola secondaria', 'Approfondimento'];
// Etichette mostrate nella UI: la chiave interna ('Scuola secondaria') resta
// quella usata per lo stato, le chiamate al modello e i tasti del font.
var LEVEL_TITLES = { 'Scuola secondaria': 'Studio del dettaglio', 'Approfondimento': 'Approfondimento' };
var FONT_MIN = 80;
var FONT_MAX = 180;
var FONT_STEP = 10;
var BASE_TEXT = 12;

function clampFont(value) {
  return Math.max(FONT_MIN, Math.min(FONT_MAX, value));
}

function FontControls({ value, onChange }) {
  function decrease() { onChange(clampFont(value - FONT_STEP)); }
  function increase() { onChange(clampFont(value + FONT_STEP)); }
  return (
    <div className="font-controls" role="group" aria-label="Dimensione del testo">
      <span className="font-label">A</span>
      <button type="button" className="font-btn" aria-label="Riduci la dimensione del testo" onClick={decrease} disabled={value <= FONT_MIN}>−</button>
      <span className="font-value" aria-live="polite">{value}%</span>
      <button type="button" className="font-btn" aria-label="Aumenta la dimensione del testo" onClick={increase} disabled={value >= FONT_MAX}>+</button>
    </div>
  );
}

function AnalysisPanel({ artwork, selection, analyses, loading, onRetry, onFeedback, onHotspotSelect }) {
  const [feedback, setFeedback] = React.useState(null);
  const [sourcesOpen, setSourcesOpen] = React.useState(true);
  const [activeLevel, setActiveLevel] = React.useState(LEVELS[0]);
  const [fontValues, setFontValues] = React.useState({ 'Scuola secondaria': 100, 'Approfondimento': 100 });

  const analysis = analyses && analyses[activeLevel] ? analyses[activeLevel] : null;
  const isError = analysis && analysis.id.indexOf('error-') === 0;
  const fontValue = fontValues[activeLevel];
  const textScale = fontValue / 100;

  // Ogni tab mostra SOLO le proprie sezioni, mai accodate a quelle dell'altra.
  const isEssentialsTab = activeLevel === 'Scuola secondaria';
  const tabSections = isEssentialsTab
    ? [
        { key: 'observation', label: 'Cosa vedi', text: analysis ? analysis.content.observation : '' },
        { key: 'meaning', label: 'Cosa significa', text: analysis ? analysis.content.meaning : '' },
        { key: 'relation', label: 'In relazione all’opera', text: analysis ? analysis.content.relation : '' }
      ]
    : [
        { key: 'curiosity', label: 'Una curiosità', text: analysis ? analysis.content.curiosity : '', accent: true },
        { key: 'comparisons', label: 'Confronti con altre opere', text: analysis ? analysis.content.comparisons : '' },
        { key: 'openQuestions', label: 'Questioni aperte', text: analysis ? analysis.content.openQuestions : '' }
      ];

  React.useEffect(function () {
    setFeedback(null);
  }, [analysis && analysis.id, loading]);

  function changeFont(nextValue) {
    setFontValues(function (current) { return Object.assign({}, current, { [activeLevel]: nextValue }); });
  }

  function switchLevel(level) {
    setActiveLevel(level);
  }

  function submitFeedback(value) {
    setFeedback(value);
    if (analysis) onFeedback(analysis, value);
  }

  const title = analysis ? analysis.title : selection ? (selection.hotspotTitle || 'Area dell’immagine') : 'Da dove vuoi cominciare?';
  const anySelection = Boolean(selection);

  return (
    <aside className="analysis-panel" aria-live="polite">
      <div className="panel-topline"><span className="ai-mark"><Icon name="sparkle" size={15} /> GUIDA AI</span><span className="secure-note">Analisi educativa</span></div>
      <div className="analysis-heading">
        <div>
          <span className="eyebrow">Dettaglio selezionato</span>
          <h2>{title}</h2>
        </div>
        <FontControls value={fontValue} onChange={changeFont} />
      </div>

      {anySelection && (
        <div className="level-tabs" role="tablist" aria-label="Livello di approfondimento">
          {LEVELS.map(function (level) {
            const selected = level === activeLevel;
            return (
              <button
                key={level}
                type="button"
                role="tab"
                aria-selected={selected}
                className={'level-tab' + (selected ? ' active' : '')}
                onClick={function () { switchLevel(level); }}
              >
                {level === 'Scuola secondaria' ? <span className="tab-mark">S</span> : <span className="tab-mark">A</span>}
                <span className="tab-copy">
                  <strong>{LEVEL_TITLES[level] || level}</strong>
                  <small>{level === 'Scuola secondaria' ? 'Sezioni essenziali' : 'Confronti e questioni aperte'}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!anySelection && !loading && !analysis && (
        <div className="empty-analysis">
          <div className="empty-orbit"><Icon name="sparkle" size={26} /></div>
          <h3>Guarda più da vicino</h3>
          <p>Fai clic su un punto dell’immagine oppure scegli uno dei punti di osservazione suggeriti.</p>
          <div className="empty-tip"><Icon name="info" size={16} /> Inizia da un volto, un colore o un elemento architettonico.</div>
        </div>
      )}

      {loading && (
        <div className="analysis-loading">
          <div className="loading-orbit"><span></span><span></span><span></span></div>
          <h3>Sto osservando il dettaglio…</h3>
          <p>Preparo in parallelo le due letture — “Studio del dettaglio” e “Approfondimento” — così le sezioni sono subito pronte.</p>
          <div className="loading-lines"><i></i><i></i><i></i></div>
        </div>
      )}

      {anySelection && !loading && !analysis && (
        <div className="empty-analysis compact">
          <div className="empty-orbit"><Icon name="sparkle" size={26} /></div>
          <h3>Nessuna analisi per questo livello</h3>
          <p>Riprova oppure seleziona un’altra zona dell’immagine.</p>
          <button className="secondary-button" onClick={onRetry}>Riprova analisi</button>
        </div>
      )}

      {anySelection && !loading && isError && (
        <div className="analysis-error"><Icon name="info" size={22} /><h3>Non riesco a completare l’analisi</h3><p>{analysis.content.observation}</p><button className="secondary-button" onClick={onRetry}>Riprova analisi</button></div>
      )}

      {anySelection && !loading && analysis && !isError && (
        <div className="analysis-result">
          <div className={'confidence ' + analysis.confidence.tone}><span className="confidence-dot"></span>{analysis.confidence.label}</div>
          <div className="analysis-sections">
            {tabSections.filter(function (section) { return section.text && String(section.text).trim(); }).map(function (section, index) {
              return <AnalysisSection key={section.key} label={section.label} text={section.text} textScale={textScale} first={index === 0} accent={section.accent} />;
            })}
            {analysis.content.lookAgain && (
              <div className="look-again">
                <Icon name="info" size={16} />
                <p style={{ fontSize: Math.round(BASE_TEXT * textScale) + 'px' }}><strong>Guarda ancora:</strong> {analysis.content.lookAgain}</p>
              </div>
            )}
            {onHotspotSelect && <ExploreAlso artwork={artwork} analysis={analysis} onHotspotSelect={onHotspotSelect} />}
          </div>
          <div className="sources-block">
            <button className="sources-toggle" onClick={() => setSourcesOpen(!sourcesOpen)} aria-expanded={sourcesOpen}>
              <span><Icon name="info" size={16} /> Fonti e riferimenti</span><Icon name="chevron" size={16} />
            </button>
            {sourcesOpen && <div className="sources-list">{analysis.sources.map(function (source) {
              return <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<span>{source.type} <Icon name="external" size={13} /></span></a>;
            })}</div>}
          </div>
          <p className="disclaimer">{analysis.disclaimer}</p>
          <div className="feedback-block">
            <span>Questa spiegazione ti è stata utile?</span>
            <div className="feedback-actions">
              <button className={feedback === 'positive' ? 'feedback selected' : 'feedback'} onClick={() => submitFeedback('positive')} aria-label="Risposta utile" aria-pressed={feedback === 'positive'}><Icon name="thumbsUp" size={16} /> Sì</button>
              <button className={feedback === 'negative' ? 'feedback selected' : 'feedback'} onClick={() => submitFeedback('negative')} aria-label="Risposta non utile" aria-pressed={feedback === 'negative'}><Icon name="thumbsDown" size={16} /> Non ancora</button>
            </div>
            {feedback && <small className="feedback-thanks">Grazie, il tuo feedback ci aiuta a migliorare.</small>}
          </div>
        </div>
      )}
    </aside>
  );
}

function AnalysisSection({ label, text, textScale, first, accent }) {
  if (!text || !String(text).trim()) return null;
  return <section className={'analysis-section ' + (first ? 'first' : '') + (accent ? ' accent' : '')}><h3>{label}</h3><p style={{ fontSize: Math.round(BASE_TEXT * textScale) + 'px' }}>{text}</p></section>;
}

function ExploreAlso({ artwork, analysis, onHotspotSelect }) {
  if (!analysis || analysis.id.indexOf('error-') === 0) return null;
  const currentId = analysis.title;
  const others = (artwork.hotspots || []).filter(h => h.title !== currentId);
  if (!others.length) return null;
  return (
    <div className="explore-also">
      <h3>Esplora anche</h3>
      <div className="explore-also-chips">
        {others.map(function (hotspot) {
          return <button key={hotspot.id} className="explore-also-chip" onClick={() => onHotspotSelect(hotspot)}><span className="chip-category">{hotspot.category}</span>{hotspot.title}</button>;
        })}
      </div>
    </div>
  );
}
