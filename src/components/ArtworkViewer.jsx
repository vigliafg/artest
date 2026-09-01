function ArtworkViewer({ artwork, selectedHotspotId, onHotspotSelect, onFreeSelect }) {
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [drag, setDrag] = React.useState(null);
  const [hoveredId, setHoveredId] = React.useState(null);
  const [mediaSize, setMediaSize] = React.useState({ width: 0, height: 0, left: 0, top: 0 });
  const imageRef = React.useRef(null);
  const stageRef = React.useRef(null);

  const resizeMedia = React.useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage) return;
    const naturalWidth = image?.naturalWidth || 1275;
    const naturalHeight = image?.naturalHeight || 900;
    const scale = Math.min(stage.clientWidth / naturalWidth, stage.clientHeight / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    setMediaSize({ width, height, left: (stage.clientWidth - width) / 2, top: (stage.clientHeight - height) / 2 });
  }, []);

  React.useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    resizeMedia();
    const observer = window.ResizeObserver ? new ResizeObserver(resizeMedia) : null;
    if (observer && stageRef.current) observer.observe(stageRef.current);
    return () => observer?.disconnect();
  }, [artwork.id, resizeMedia]);

  function changeZoom(delta) {
    setZoom((current) => {
      const next = Math.max(1, Math.min(3, Number((current + delta).toFixed(2))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }); }

  function getNormalizedPoint(event) {
    const rect = imageRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    setDrag({ clientX: event.clientX, clientY: event.clientY, moved: false });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      setDrag({ clientX: event.clientX, clientY: event.clientY, moved: true });
      if (zoom > 1) setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
    }
  }

  function handlePointerUp(event) {
    if (!drag) return;
    const moved = drag.moved;
    setDrag(null);
    if (!moved) onFreeSelect(getNormalizedPoint(event));
  }

  return (
    <section className="viewer-shell" aria-label={'Esplora ' + artwork.title}>
      <div className="viewer-toolbar">
        <span className="viewer-hint"><Icon name="sparkle" size={15} /> Seleziona un dettaglio per iniziare</span>
        <div className="viewer-controls" aria-label="Controlli immagine">
          <button className="icon-button" onClick={() => changeZoom(-0.25)} disabled={zoom <= 1} aria-label="Riduci zoom"><Icon name="minus" /></button>
          <span className="zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button className="icon-button" onClick={() => changeZoom(0.25)} disabled={zoom >= 3} aria-label="Aumenta zoom"><Icon name="plus" /></button>
          <button className="icon-button reset-button" onClick={resetView} aria-label="Ripristina vista"><Icon name="reset" /></button>
        </div>
      </div>
      <div ref={stageRef} className={'artwork-stage ' + (zoom > 1 ? 'is-zoomed' : '')} tabIndex="0" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => setDrag(null)} onKeyDown={(event) => { if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(0.25); } if (event.key === '-') { event.preventDefault(); changeZoom(-0.25); } if (event.key === '0') { event.preventDefault(); resetView(); } }} role="application" aria-label="Area interattiva dell’immagine. Usa i controlli o l’elenco hotspot per navigare.">
        <div className="artwork-canvas" style={{ width: mediaSize.width ? mediaSize.width + 'px' : '100%', height: mediaSize.height ? mediaSize.height + 'px' : '100%', left: mediaSize.left + 'px', top: mediaSize.top + 'px', transform: 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')' }}>
          <img ref={imageRef} src={artwork.image} alt={artwork.alt} onLoad={resizeMedia} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = artwork.fallbackImage; }} draggable="false" />
          <div className="hotspot-layer" aria-hidden="true">
            {artwork.hotspots.map((hotspot) => <span key={hotspot.id} className={'hotspot-region ' + (selectedHotspotId === hotspot.id ? 'active' : '') + (hoveredId === hotspot.id ? ' hovered' : '')} style={{ left: hotspot.region.x * 100 + '%', top: hotspot.region.y * 100 + '%', width: hotspot.region.width * 100 + '%', height: hotspot.region.height * 100 + '%' }} />)}
          </div>
        </div>
      </div>
      <div className="hotspot-strip">
        <div className="hotspot-strip-heading"><span className="eyebrow">Punti di osservazione</span><span className="hotspot-count">{artwork.hotspots.length} suggerimenti</span></div>
        <div className="hotspot-list">
          {artwork.hotspots.map((hotspot, index) => <button key={hotspot.id} className={'hotspot-chip ' + (selectedHotspotId === hotspot.id ? 'selected' : '')} onClick={() => onHotspotSelect(hotspot)} onMouseEnter={() => setHoveredId(hotspot.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(hotspot.id)} onBlur={() => setHoveredId(null)} aria-pressed={selectedHotspotId === hotspot.id}><span className="chip-index">{String(index + 1).padStart(2, '0')}</span><span><strong>{hotspot.title}</strong><small>{hotspot.category}</small></span><Icon name="arrow" size={16} /></button>)}
        </div>
      </div>
    </section>
  );
}
