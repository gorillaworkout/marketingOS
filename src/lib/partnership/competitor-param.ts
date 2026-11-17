/** Query param that opens a competitor's detail dialog on Competitor Intelligence. */

export const COMPETITOR_PARAM = 'competitor';

function asParams(search: string | URLSearchParams): URLSearchParams {
  if (typeof search !== 'string') return new URLSearchParams(search.toString());
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

export function competitorIdFromSearch(search: string | URLSearchParams): string {
  return (asParams(search).get(COMPETITOR_PARAM) || '').trim();
}

/** Path with `?competitor=` set or removed, keeping any other query params. */
export function competitorPageUrl(pathname: string, search: string | URLSearchParams, competitorId: string | null): string {
  const params = asParams(search);
  const id = competitorId?.trim() || '';
  if (id) params.set(COMPETITOR_PARAM, id);
  else params.delete(COMPETITOR_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
