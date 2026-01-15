import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DonationContextType {
  refreshTrigger: number;
  triggerRefresh: () => void;
  lastDonationMouths: number;
  setLastDonationMouths: (mouths: number) => void;
}

const DonationContext = createContext<DonationContextType | null>(null);

export function DonationProvider({ children }: { children: ReactNode }) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [lastDonationMouths, setLastDonationMouths] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  return (
    <DonationContext.Provider value={{ 
      refreshTrigger, 
      triggerRefresh, 
      lastDonationMouths, 
      setLastDonationMouths 
    }}>
      {children}
    </DonationContext.Provider>
  );
}

export function useDonation() {
  const context = useContext(DonationContext);
  if (!context) {
    throw new Error('useDonation must be used within a DonationProvider');
  }
  return context;
}
