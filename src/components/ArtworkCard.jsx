function ArtworkCard({ artwork, onOpen }) {
  return (
    <button className="artwork-card" onClick={() => onOpen(artwork)} aria-label={'Apri ' + artwork.title}>
      <div className="card-image-wrap">
        <img src={artwork.image} alt={artwork.alt} className="card-image" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = artwork.fallbackImage; }} />
        {artwork.featured && <span className="card-badge">In evidenza</span>}
        <span className="card-arrow"><Icon name="arrow" size={18} /></span>
      </div>
      <div className="card-copy">
        <div className="eyebrow">{artwork.period}</div>
        <h3>{artwork.title}</h3>
        <p>{artwork.artist} <span>·</span> {artwork.date}</p>
      </div>
    </button>
  );
}
