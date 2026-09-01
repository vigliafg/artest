window.APP_DATA = {
  artworks: [
    {
      id: 'annunciazione-beato-angelico',
      title: 'Annunciazione',
      artist: 'Beato Angelico',
      date: 'c. 1440–1445',
      period: 'Rinascimento fiorentino',
      technique: 'Affresco',
      institution: 'Museo di San Marco, Firenze',
      location: 'Corridoio nord, Convento di San Marco',
      image: './annunciazione-beato-angelico.jpg',
      fallbackImage: 'https://commons.wikimedia.org/wiki/Special:FilePath/Fra%20Angelico%20-%20The%20Annunciation%20-%20WGA00555.jpg?width=1275',
      accent: '#c98542',
      description: 'Nel silenzio del chiostro di San Marco, l’angelo Gabriele annuncia a Maria la nascita di Gesù. Beato Angelico costruisce la scena con luce, architettura e gesti misurati, invitando chi guarda a fermarsi e osservare.',
      alt: 'L’Annunciazione del Beato Angelico: Maria e l’angelo sono seduti sotto un portico rinascimentale, illuminato da una luce chiara.',
      rights: 'Immagine fornita per uso didattico; verificare i diritti prima della pubblicazione.',
      featured: true,
      levels: ['Scuola secondaria', 'Approfondimento'],
      sources: [
        { title: 'Museo Nazionale di San Marco', type: 'Museo', url: 'https://museitoscani.cultura.gov.it/museo-di-san-marco/' },
        { title: 'Treccani — Beato Angelico', type: 'Enciclopedia', url: 'https://www.treccani.it/enciclopedia/beato-angelico/' }
      ],
      hotspots: [
        {
          id: 'angelo-gabriele',
          title: 'L’angelo Gabriele',
          category: 'Figura',
          region: { x: 0.33, y: 0.24, width: 0.28, height: 0.58 },
          short: 'Il messaggero inginocchiato',
          insight: 'Il gesto e le ali rendono riconoscibile il messaggero divino.'
        },
        {
          id: 'maria',
          title: 'Maria e il gesto dell’ascolto',
          category: 'Figura',
          region: { x: 0.64, y: 0.25, width: 0.3, height: 0.58 },
          short: 'La risposta di Maria',
          insight: 'La posizione composta comunica attenzione, umiltà e accettazione.'
        },
        {
          id: 'portico',
          title: 'Il portico rinascimentale',
          category: 'Composizione',
          region: { x: 0.02, y: 0.08, width: 0.96, height: 0.76 },
          short: 'Lo spazio che ordina la scena',
          insight: 'Le colonne e le arcate guidano lo sguardo verso l’incontro.'
        },
        {
          id: 'giardino',
          title: 'Il giardino sullo sfondo',
          category: 'Simbolo',
          region: { x: 0.05, y: 0.38, width: 0.2, height: 0.25 },
          short: 'Natura e significato',
          insight: 'Il giardino separato allude a uno spazio speciale e protetto.'
        },
        {
          id: 'luce',
          title: 'La luce chiara',
          category: 'Luce',
          region: { x: 0.08, y: 0.12, width: 0.84, height: 0.62 },
          short: 'Una luce senza forti contrasti',
          insight: 'La luminosità diffusa crea un’atmosfera calma e contemplativa.'
        }
      ]
    }
  ]
};
