function ExplorePage({ artwork, onBack }) {
  const [selectedHotspot, setSelectedHotspot] = React.useState(null);
  const [selection, setSelection] = React.useState(null);
  const [analyses, setAnalyses] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [feedbacks, setFeedbacks] = React.useState([]);
  const requestId = React.useRef(0);

  const LEVELS = ['Scuola secondaria', 'Approfondimento'];

  function createSelectionImage(nextSelection) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        try {
          var padding = 0.025;
          var x = Math.max(0, nextSelection.x - padding);
          var y = Math.max(0, nextSelection.y - padding);
          var right = Math.min(1, nextSelection.x + (nextSelection.width || 0.12) + padding);
          var bottom = Math.min(1, nextSelection.y + (nextSelection.height || 0.12) + padding);
          var sourceWidth = Math.max(1, Math.round((right - x) * image.naturalWidth));
          var sourceHeight = Math.max(1, Math.round((bottom - y) * image.naturalHeight));
          var scale = Math.min(1, 900 / Math.max(sourceWidth, sourceHeight));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(sourceWidth * scale));
          canvas.height = Math.max(1, Math.round(sourceHeight * scale));
          canvas.getContext('2d').drawImage(image, Math.round(x * image.naturalWidth), Math.round(y * image.naturalHeight), sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (_error) { resolve(null); }
      };
      image.onerror = function () { resolve(null); };
      image.src = artwork.image;
    });
  }

  function buildErrorResult(error, hotspot) {
    return {
      id: 'error-' + Date.now(),
      title: hotspot ? hotspot.title : 'Area selezionata',
      confidence: { label: 'Analisi non disponibile', tone: 'warm' },
      content: { observation: error.message, meaning: '', relation: '', curiosity: '', comparisons: '', openQuestions: '', lookAgain: '' },
      sources: artwork.sources,
      disclaimer: 'Controlla la configurazione del backend OpenRouter e riprova.'
    };
  }

  // Lancio i due livelli in parallelo: una chiamata per "Scuola secondaria"
  // e una per "Approfondimento", così entrambe le tab si popolano insieme.
  function runAnalysis(nextSelection, hotspot) {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setSelectedHotspot(hotspot || null);
    setSelection({ ...nextSelection, hotspotTitle: hotspot ? hotspot.title : 'Area selezionata' });
    setAnalyses({});
    setLoading(true);
    createSelectionImage(nextSelection).then(function (selectionImage) {
      return Promise.all(LEVELS.map(function (level) {
        return window.AnalysisService.analyze(artwork, nextSelection, level, selectionImage)
          .then(function (result) { return { level: level, result: result }; })
          .catch(function (error) { return { level: level, result: buildErrorResult(error, hotspot) }; });
      }));
    }).then(function (entries) {
      if (currentRequestId !== requestId.current) return;
      var byLevel = {};
      entries.forEach(function (entry) { byLevel[entry.level] = entry.result; });
      setAnalyses(byLevel);
      setLoading(false);
    });
  }

  function chooseHotspot(hotspot) {
    runAnalysis({ type: 'hotspot', hotspotId: hotspot.id, ...hotspot.region }, hotspot);
  }

  function chooseFree(point) {
    runAnalysis({ type: 'free', x: point.x, y: point.y, width: 0.12, height: 0.12 }, null);
  }

  function retry() {
    if (selection) runAnalysis(selection, selectedHotspot);
  }

  function handleFeedback(result, value) {
    setFeedbacks(function (current) { return current.concat({ analysisId: result.id, value: value }); });
  }

  return (
    <main className="explore-page">
      <header className="explore-header">
        <button className="back-button" onClick={onBack}><span className="back-icon">←</span> Torna alla collezione</button>
        <div className="explore-progress"><span>01</span><i></i><span>Esplorazione guidata</span></div>
        <button className="header-info" aria-label="Informazioni sull’esperienza"><Icon name="info" size={18} /></button>
      </header>
      <section className="explore-intro"><div><span className="eyebrow">{artwork.period}</span><h1>{artwork.title}</h1><p>{artwork.artist} <span>·</span> {artwork.date} <span>·</span> {artwork.institution}</p></div><div className="explore-tag"><Icon name="sparkle" size={15} /> Esplora i dettagli</div></section>
      <ArtworkOverview artwork={artwork} />
      <section className="exploration-layout">
        <div className="viewer-column"><ArtworkViewer artwork={artwork} selectedHotspotId={selectedHotspot && selectedHotspot.id} onHotspotSelect={chooseHotspot} onFreeSelect={chooseFree} /><div className="rights-line">{artwork.rights}</div></div>
        <AnalysisPanel artwork={artwork} selection={selection} analyses={analyses} loading={loading} onRetry={retry} onFeedback={handleFeedback} onHotspotSelect={chooseHotspot} />
      </section>
    </main>
  );
}
