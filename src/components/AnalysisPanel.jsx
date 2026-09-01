function AnalysisPanel({ artwork, selection, analysis, loading, level, onLevelChange, onRetry, onFeedback }) {
  const [feedback, setFeedback] = React.useState(null);
  const [sourcesOpen, setSourcesOpen] = React.useState(true);

  React.useEffect(() => setFeedback(null), [analysis && analysis.id, loading]);

  function submitFeedback(value) {
    setFeedback(value);
    if (analysis) onFeedback(analysis, value);
  }

  return (
    <aside className="analysis-panel" aria-live="polite">
      <div className="panel-topline"><span className="ai-mark"><Icon name="sparkle" size={15} /> GUIDA AI</span><span className="secure-note">Analisi educativa</span></div>
      <div className="analysis-heading">
        <div>
          <span className="eyebrow">Dettaglio selezionato</span>
          <h2>{analysis ? analysis.title : selection ? (selection.hotspotTitle || 'Area dell’immagine') : 'Da dove vuoi cominciare?'}</h2>
        </div>
        <div className="level-select-wrap">
          <label htmlFor="learning-level">Livello</label>
          <select id="learning-level" value={level} onChange={(event) => onLevelChange(event.target.value)}>
            <option>Scuola secondaria</option>
            <option>Approfondimento</option>
          </select>
        </div>
      </div>

      {!selection && !loading && !analysis && (
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
          <p>Collego ciò che vediamo al contesto dell’opera e alle fonti selezionate.</p>
          <div className="loading-lines"><i></i><i></i><i></i></div>
        </div>
      )}

      {analysis && !loading && !analysis.id.startsWith('error-') && (
        <div className="analysis-result">
          <div className={'confidence ' + analysis.confidence.tone}><span className="confidence-dot"></span>{analysis.confidence.label}</div>
          <div className="analysis-sections">
            <AnalysisSection label="Che cosa stai osservando" text={analysis.content.observation} first />
            <AnalysisSection label="Perché è importante" text={analysis.content.importance} />
            <AnalysisSection label="Come contribuisce all’opera" text={analysis.content.composition} />
            <AnalysisSection label="Una curiosità" text={analysis.content.curiosity} accent />
            <AnalysisSection label="Un collegamento" text={analysis.content.connection} />
          </div>
          <div className="sources-block">
            <button className="sources-toggle" onClick={() => setSourcesOpen(!sourcesOpen)} aria-expanded={sourcesOpen}>
              <span><Icon name="info" size={16} /> Fonti selezionate</span><Icon name="chevron" size={16} />
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

      {selection && !loading && (!analysis || analysis.id.startsWith('error-')) && (
        <div className="analysis-error"><Icon name="info" size={22} /><h3>Non riesco a completare l’analisi</h3><p>{analysis && analysis.id.startsWith('error-') ? analysis.content.observation : 'Puoi riprovare oppure selezionare un’altra zona dell’immagine.'}</p><button className="secondary-button" onClick={onRetry}>Riprova analisi</button></div>
      )}
    </aside>
  );
}

function AnalysisSection({ label, text, first, accent }) {
  return <section className={'analysis-section ' + (first ? 'first' : '') + (accent ? 'accent' : '')}><h3>{label}</h3><p>{text}</p></section>;
}
