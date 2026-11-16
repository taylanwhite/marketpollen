/** One piece of a Google Places (New) address, e.g. { longText: 'Moore', types: ['locality', …] }. */
export type GoogleAddressComponent = { longText?: string; shortText?: string; types?: string[] };

export type AddressFields = { address?: string; city?: string; state?: string; zipCode?: string };

/**
 * A Google place's address split the way the app stores it: the street line
 * on its own ("1600 S Eastern Ave"), then city, two-letter state, and ZIP.
 * Same rules as the address picker, so every business looks the same.
 *
 * Google's one-line formattedAddress ("1600 S Eastern Ave, Moore, OK 73160,
 * USA") is only used for the street when the place has no street number or
 * road (e.g. a mall), and then only its first part.
 */
export function placeAddressFields(
  components: GoogleAddressComponent[] | undefined,
  formattedAddress?: string | null,
): AddressFields {
  const find = (type: string) => (components || []).find((c) => (c.types || []).includes(type));
  const long = (type: string) => find(type)?.longText ?? find(type)?.shortText ?? '';
  const short = (type: string) => find(type)?.shortText ?? find(type)?.longText ?? '';

  const city = long('locality') || long('postal_town') || long('sublocality') || long('administrative_area_level_3') || undefined;
  const state = short('administrative_area_level_1') || undefined;
  const zipCode = long('postal_code') || undefined;

  const unit = long('subpremise');
  let street = [long('street_number'), long('route')].filter(Boolean).join(' ').trim();
  if (street && unit) street = `${street} #${unit}`;
  if (!street && formattedAddress) {
    const first = formattedAddress.split(',')[0]?.trim() || '';
    const isTownOrState = !first || [city, state, zipCode].some((part) => part && first.toLowerCase().startsWith(part.toLowerCase()));
    if (!isTownOrState) street = first;
  }

  return { address: street || undefined, city, state, zipCode };
}
