export function cleanOrganizationType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 80);
  return trimmed || null;
}

/** Keep only the last four digits. Full card numbers are never stored. */
export function cleanCardLast4(value: unknown): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  return digits.slice(-4);
}

export function cleanCorporateStatus(value: unknown): 'active' | 'inactive' | null {
  if (value === 'active' || value === 'inactive') return value;
  return null;
}

export function cleanTaxExempt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 64);
  return trimmed || null;
}

type ProfileBody = {
  organizationType?: string | null;
  isCorporateAccount?: boolean;
  taxExemptNumber?: string | null;
  cardOnFileLast4?: string | null;
  corporateStatus?: string | null;
};

export function contactProfileData(body: ProfileBody, partial: boolean) {
  const data: {
    organization_type?: string | null;
    is_corporate_account?: boolean;
    tax_exempt_number?: string | null;
    card_on_file_last4?: string | null;
    corporate_status?: string | null;
  } = {};

  if (!partial || body.organizationType !== undefined) {
    data.organization_type = cleanOrganizationType(body.organizationType);
  }
  if (!partial || body.isCorporateAccount !== undefined) {
    data.is_corporate_account = body.isCorporateAccount === true;
  }
  if (!partial || body.taxExemptNumber !== undefined) {
    data.tax_exempt_number = cleanTaxExempt(body.taxExemptNumber);
  }
  if (!partial || body.cardOnFileLast4 !== undefined) {
    data.card_on_file_last4 = cleanCardLast4(body.cardOnFileLast4);
  }
  if (!partial || body.corporateStatus !== undefined) {
    data.corporate_status = cleanCorporateStatus(body.corporateStatus);
  }

  return data;
}
