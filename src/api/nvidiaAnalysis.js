window.AnalysisService = {
  overview: function (artwork, level) {
    return fetch('/api/overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artwork: {
          title: artwork.title,
          artist: artwork.artist,
          date: artwork.date,
          period: artwork.period,
          technique: artwork.technique,
          institution: artwork.institution,
          location: artwork.location
        },
        sources: artwork.sources,
        learningLevel: level,
        language: 'it'
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) throw new Error((payload.error && payload.error.message) || 'La presentazione non è disponibile.');
        return payload;
      });
    });
  },

  analyze: function (artwork, selection, level, selectionImage) {
    return fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artwork: {
          title: artwork.title,
          artist: artwork.artist,
          date: artwork.date,
          period: artwork.period,
          technique: artwork.technique,
          institution: artwork.institution,
          location: artwork.location
        },
        selection: selection,
        hotspot: artwork.hotspots.find(function (item) { return item.id === selection.hotspotId; }) || null,
        notableDetails: artwork.hotspots.map(function (item) {
          return { title: item.title, category: item.category, short: item.short };
        }),
        sources: artwork.sources,
        learningLevel: level,
        language: 'it',
        selectionImage: selectionImage || null
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) throw new Error((payload.error && payload.error.message) || 'Il servizio di analisi non è disponibile.');
        return payload;
      });
    });
  }
};
