/**
 * One line for showing a place's address: the street plus town, state, and
 * ZIP. Older rows saved Google's whole one-line address in the street field,
 * so the town and ZIP are only added when the street doesn't already have them.
 */
export function displayAddress(p: { address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null }): string {
  const street = p.address?.trim() || '';
  // Already a whole address ("1500 S Service Rd, Moore, OK 73160, USA").
  if (street.includes(',')) return street;
  const lower = street.toLowerCase();
  const rest = [p.city, p.state, p.zipCode]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part && !lower.includes(part.toLowerCase()));
  return [street, ...rest].filter(Boolean).join(', ');
}
