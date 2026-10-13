import { FILTER_TYPE_CATEGORIES } from '../components/FilterTypeDialog';

export interface ContactProfileExtras {
  organizationType: string;
}

export interface CorporateAccountFields {
  isCorporateAccount: boolean;
  taxExemptNumber: string;
  cardOnFileLast4: string;
  corporateStatus: string;
}

export const emptyContactProfileExtras = (): ContactProfileExtras => ({
  organizationType: '',
});

export const emptyCorporateAccount = (): CorporateAccountFields => ({
  isCorporateAccount: false,
  taxExemptNumber: '',
  cardOnFileLast4: '',
  corporateStatus: '',
});

export function corporateAccountFromBusiness(business?: {
  isCorporateAccount?: boolean;
  taxExemptNumber?: string | null;
  cardOnFileLast4?: string | null;
  corporateStatus?: string | null;
} | null): CorporateAccountFields {
  return {
    isCorporateAccount: business?.isCorporateAccount === true,
    taxExemptNumber: business?.taxExemptNumber || '',
    cardOnFileLast4: business?.cardOnFileLast4 || '',
    corporateStatus: business?.corporateStatus || '',
  };
}

export function organizationTypeSections(): Array<{ name: string; types: string[] }> {
  const seen = new Set<string>();
  return FILTER_TYPE_CATEGORIES.map((section) => ({
    name: section.name,
    types: section.types.filter((type) => {
      const key = type.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  })).filter((section) => section.types.length > 0);
}

export function knownOrganizationTypes(): string[] {
  return organizationTypeSections().flatMap((section) => section.types);
}

export function contactProfilePayload(value: ContactProfileExtras) {
  return {
    organizationType: value.organizationType.trim() || null,
  };
}

export function corporateAccountPayload(value: CorporateAccountFields) {
  const corporate = value.isCorporateAccount;
  return {
    isCorporateAccount: corporate,
    taxExemptNumber: corporate ? value.taxExemptNumber.trim() || null : null,
    cardOnFileLast4: corporate ? value.cardOnFileLast4.replace(/\D/g, '').slice(-4) || null : null,
    corporateStatus: corporate ? (value.corporateStatus === 'inactive' ? 'inactive' : 'active') : null,
  };
}
