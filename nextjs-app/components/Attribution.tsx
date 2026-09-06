// Footer backlink to 8Examples Inc. (spec F29: attribution can be hidden on plans that allow it)
export function Attribution({ lang }: { lang: 'en' | 'fr' }) {
  return (
    <p className="text-sm text-gray-700 mt-2">
      {lang === 'fr' ? 'Conçu par ' : 'Built by '}
      <a href="https://8examples.com" rel="noopener">8Examples Inc.</a>
    </p>
  );
}
