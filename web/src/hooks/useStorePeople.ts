import { useEffect, useState } from 'react';
import { api } from '../api/client';

export type StorePerson = { id: string; name: string };

/** Everyone with access to a store (or every store in an org), for marketer pickers. */
export function useStorePeople(scope: { storeId?: string | null; orgId?: string | null }): StorePerson[] {
  const query = scope.storeId ? `storeId=${scope.storeId}` : scope.orgId ? `orgId=${scope.orgId}` : '';
  // Results are kept with the query they answer, so a stale list never shows for another store.
  const [loaded, setLoaded] = useState<{ query: string; people: StorePerson[] }>({ query: '', people: [] });
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    api.get<StorePerson[]>(`/store-people?${query}`)
      .then((people) => { if (!cancelled) setLoaded({ query, people }); })
      .catch(() => { if (!cancelled) setLoaded({ query, people: [] }); });
    return () => { cancelled = true; };
  }, [query]);
  return loaded.query === query ? loaded.people : [];
}
