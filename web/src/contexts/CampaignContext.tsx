import { createContext, useContext, ReactNode, useMemo } from 'react';
import { usePermissions } from './PermissionContext';
import { CampaignProduct, MOUTH_VALUES, QUARTERLY_GOAL } from '../types';

interface CampaignContextType {
  products: CampaignProduct[];
  orgGoal: number;
  storeGoal: number;
  orgName: string;
  loading: boolean;
}

const DEFAULT_PRODUCTS: CampaignProduct[] = [
  { id: 'default-1', slug: 'freeBundletCard', name: 'FREE Bundtlet Card', mouthValue: MOUTH_VALUES.freeBundletCard, displayOrder: 0, isActive: true, reachoutColumn: 'free_bundlet_card' },
  { id: 'default-2', slug: 'dozenBundtinis', name: 'Dozen Bundtinis', mouthValue: MOUTH_VALUES.dozenBundtinis, displayOrder: 1, isActive: true, reachoutColumn: 'dozen_bundtinis' },
  { id: 'default-3', slug: 'cake8inch', name: '8" Cake', mouthValue: MOUTH_VALUES.cake8inch, displayOrder: 2, isActive: true, reachoutColumn: 'cake_8inch' },
  { id: 'default-4', slug: 'cake10inch', name: '10" Cake', mouthValue: MOUTH_VALUES.cake10inch, displayOrder: 3, isActive: true, reachoutColumn: 'cake_10inch' },
  { id: 'default-5', slug: 'sampleTray', name: 'Sample Tray', mouthValue: MOUTH_VALUES.sampleTray, displayOrder: 4, isActive: true, reachoutColumn: 'sample_tray' },
  { id: 'default-6', slug: 'bundtletTower', name: 'Bundtlet/Tower', mouthValue: MOUTH_VALUES.bundtletTower, displayOrder: 5, isActive: true, reachoutColumn: 'bundtlet_tower' },
];

const CampaignContext = createContext<CampaignContextType>({
  products: DEFAULT_PRODUCTS,
  orgGoal: QUARTERLY_GOAL,
  storeGoal: QUARTERLY_GOAL,
  orgName: '',
  loading: true,
});

export function useCampaign() {
  return useContext(CampaignContext);
}

export function CampaignProvider({ children }: { children: ReactNode }) {
  const { currentOrg, loading: permLoading } = usePermissions();

  const value = useMemo<CampaignContextType>(() => {
    if (!currentOrg) {
      return {
        products: DEFAULT_PRODUCTS,
        orgGoal: QUARTERLY_GOAL,
        storeGoal: QUARTERLY_GOAL,
        orgName: '',
        loading: permLoading,
      };
    }

    const activeProducts = currentOrg.products.filter(p => p.isActive);
    const orgGoal = currentOrg.quarterlyGoal;
    const storeGoal = orgGoal;

    return {
      products: activeProducts.length > 0 ? activeProducts : DEFAULT_PRODUCTS,
      orgGoal,
      storeGoal,
      orgName: currentOrg.name,
      loading: permLoading,
    };
  }, [currentOrg, permLoading]);

  return (
    <CampaignContext.Provider value={value}>
      {children}
    </CampaignContext.Provider>
  );
}
