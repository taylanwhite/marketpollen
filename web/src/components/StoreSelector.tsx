import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { usePermissions } from '../contexts/PermissionContext';
import { Store } from '../types';

export function StoreSelector() {
  const { permissions, setCurrentStore, isAdmin } = usePermissions();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStores();
  }, []);

  const loadStores = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'stores'));
      const storeList: Store[] = [];
      querySnapshot.forEach((doc) => {
        storeList.push({ id: doc.id, ...doc.data() } as Store);
      });
      storeList.sort((a, b) => a.name.localeCompare(b.name));
      setStores(storeList);
    } catch (error) {
      console.error('Error loading stores:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter stores based on user permissions
  const availableStores = isAdmin()
    ? stores
    : stores.filter(store =>
        permissions.storePermissions.some(p => p.storeId === store.id)
      );

  if (loading || availableStores.length === 0) {
    return null;
  }

  return (
    <div className="store-selector">
      <label htmlFor="current-store">📍 Store:</label>
      <select
        id="current-store"
        value={permissions.currentStoreId || ''}
        onChange={(e) => setCurrentStore(e.target.value)}
        className="store-select"
      >
        {availableStores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
          </option>
        ))}
      </select>
    </div>
  );
}
