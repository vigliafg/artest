const ICON_PATHS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  search: 'm21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z',
  chevron: 'm6 9 6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  reset: 'M4 12a8 8 0 1 0 2.34-5.66L4 8.68M4 4v4.68h4.68',
  external: 'M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5',
  info: 'M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  sparkle: 'm12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z',
  thumbsUp: 'M7 10v10H4V10h3Zm0 10h9.2a2 2 0 0 0 1.96-1.6l1.2-6A2 2 0 0 0 17.4 10H14l.5-3.1A2.5 2.5 0 0 0 12 4.5L7 10',
  thumbsDown: 'M7 14V4H4v10h3Zm0-10h9.2a2 2 0 0 1 1.96 1.6l1.2 6A2 2 0 0 1 17.4 14H14l.5 3.1a2.5 2.5 0 0 1-2.5 2.4L7 14'
};

function Icon({ name, size = 20, strokeWidth = 1.8, title }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={ICON_PATHS[name]} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
