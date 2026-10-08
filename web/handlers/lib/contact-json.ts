export function personName(user?: { display_name?: string | null; email?: string | null } | null): string | null {
  const name = user?.display_name?.trim();
  if (name) return name;
  const email = user?.email?.trim();
  return email || null;
}

export const contactInclude = {
  creator: { select: { display_name: true, email: true } },
  reachouts: {
    orderBy: { date: 'desc' as const },
    include: { creator: { select: { display_name: true, email: true } } },
  },
  contact_files: { orderBy: { uploaded_at: 'desc' as const } },
};

export function reachoutToJson(r: any) {
  const customDonations = r.custom_donations as Record<string, number> | null;
  const hasDonation = r.free_bundlet_card || r.dozen_bundtinis || r.cake_8inch || r.cake_10inch || r.sample_tray || r.bundtlet_tower || r.cakes_donated_notes || (customDonations && Object.keys(customDonations).length > 0);
  return {
    id: r.id,
    date: r.date,
    note: r.note,
    rawNotes: r.raw_notes ?? null,
    createdBy: r.created_by,
    createdByName: personName(r.creator),
    type: r.type || 'other',
    donation: hasDonation
      ? {
          freeBundletCard: r.free_bundlet_card ?? 0,
          dozenBundtinis: r.dozen_bundtinis ?? 0,
          cake8inch: r.cake_8inch ?? 0,
          cake10inch: r.cake_10inch ?? 0,
          sampleTray: r.sample_tray ?? 0,
          bundtletTower: r.bundtlet_tower ?? 0,
          customItems: customDonations ?? undefined,
          cakesDonatedNotes: r.cakes_donated_notes ?? undefined,
          orderedFromUs: r.ordered_from_us ?? false,
          followedUp: r.followed_up ?? false,
          noFollowUp: r.no_follow_up ?? false,
        }
      : undefined,
  };
}

export function fileToJson(f: any) {
  return {
    id: f.id,
    contactId: f.contact_id,
    name: f.name,
    storagePath: f.storage_path,
    downloadUrl: f.download_url,
    size: Number(f.size),
    mimeType: f.mime_type,
    uploadedAt: f.uploaded_at,
    uploadedBy: f.uploaded_by,
  };
}

export function contactToJson(c: any) {
  return {
    id: c.id,
    businessId: c.business_id,
    storeId: c.store_id,
    contactId: c.contact_id,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    employeeCount: c.employee_count ?? null,
    personalDetails: c.personal_details ?? null,
    suggestedFollowUpDate: c.suggested_follow_up_date ?? null,
    suggestedFollowUpMethod: c.suggested_follow_up_method ?? null,
    suggestedFollowUpNote: c.suggested_follow_up_note ?? null,
    suggestedFollowUpPriority: c.suggested_follow_up_priority ?? null,
    lastReachoutDate: c.last_reachout_date ?? null,
    status: c.status ?? null,
    createdAt: c.created_at,
    createdBy: c.created_by,
    createdByName: personName(c.creator),
    reachouts: (c.reachouts || []).map(reachoutToJson),
    contactFiles: (c.contact_files || []).map(fileToJson),
  };
}
