import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DonationContextType {
  /** Bumped to retrigger the goal/mouths animation in the header */
  refreshTrigger: number;
  triggerRefresh: () => void;
  /**
   * Generic "data has changed, please refetch" signal. Bumped after any
   * successful save (contact, reachout, follow-up, etc). Pages subscribe to
   * this in their data-loading effects so an action taken in a dialog or
   * sheet immediately reflects under the dialog.
   */
  dataVersion: number;
  bumpDataVersion: () => void;
  lastDonationMouths: number;
  setLastDonationMouths: (mouths: number) => void;
}

const DonationContext = createContext<DonationContextType | null>(null);

export function DonationProvider({ children }: { children: ReactNode }) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [lastDonationMouths, setLastDonationMouths] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);
  const bumpDataVersion = useCallback(() => {
    setDataVersion((prev) => prev + 1);
  }, []);

  return (
    <DonationContext.Provider
      value={{
        refreshTrigger,
        triggerRefresh,
        dataVersion,
        bumpDataVersion,
        lastDonationMouths,
        setLastDonationMouths,
      }}
    >
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
