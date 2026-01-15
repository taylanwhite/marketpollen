import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { usePermissions } from '../contexts/PermissionContext';
import { Location } from '../types';

export function LocationSelector() {
  const { permissions, setCurrentLocation, isAdmin } = usePermissions();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'locations'));
      const locationList: Location[] = [];
      querySnapshot.forEach((doc) => {
        locationList.push({ id: doc.id, ...doc.data() } as Location);
      });
      locationList.sort((a, b) => a.name.localeCompare(b.name));
      setLocations(locationList);
    } catch (error) {
      console.error('Error loading locations:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter locations based on user permissions
  const availableLocations = isAdmin()
    ? locations
    : locations.filter(loc =>
        permissions.locationPermissions.some(p => p.locationId === loc.id)
      );

  if (loading || availableLocations.length === 0) {
    return null;
  }

  return (
    <div className="location-selector">
      <label htmlFor="current-location">📍 Location:</label>
      <select
        id="current-location"
        value={permissions.currentLocationId || ''}
        onChange={(e) => setCurrentLocation(e.target.value)}
        className="location-select"
      >
        {availableLocations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </div>
  );
}
