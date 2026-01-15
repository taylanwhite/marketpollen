// Utility to parse voice transcript and extract contact information
export interface ParsedContactInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
}

export function parseVoiceTranscript(transcript: string): ParsedContactInfo {
  const info: ParsedContactInfo = {};
  
  // Email pattern
  const emailMatch = transcript.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  if (emailMatch) {
    info.email = emailMatch[0];
  }

  // Phone number patterns (various formats)
  const phonePatterns = [
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // 123-456-7890 or 123.456.7890
    /\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/, // (123) 456-7890
    /\b\d{10}\b/, // 1234567890
  ];
  
  for (const pattern of phonePatterns) {
    const phoneMatch = transcript.match(pattern);
    if (phoneMatch) {
      info.phone = phoneMatch[0].replace(/\D/g, ''); // Remove non-digits
      if (info.phone.length === 10) {
        info.phone = `(${info.phone.slice(0, 3)}) ${info.phone.slice(3, 6)}-${info.phone.slice(6)}`;
      }
      break;
    }
  }

  // Try to extract name (look for "name is" or "I'm" patterns)
  const namePatterns = [
    /(?:name is|my name is|I'm|I am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /(?:contact|person|client)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = transcript.match(pattern);
    if (nameMatch && nameMatch[1]) {
      const nameParts = nameMatch[1].trim().split(/\s+/);
      if (nameParts.length >= 1) {
        info.firstName = nameParts[0];
      }
      if (nameParts.length >= 2) {
        info.lastName = nameParts.slice(1).join(' ');
      }
      break;
    }
  }

  // Company pattern
  const companyPatterns = [
    /(?:company is|works at|from)\s+([A-Z][A-Za-z\s&]+)/i,
    /(?:at|with)\s+([A-Z][A-Za-z\s&]+?)(?:\s+(?:company|corp|inc|llc))?/i,
  ];
  
  for (const pattern of companyPatterns) {
    const companyMatch = transcript.match(pattern);
    if (companyMatch && companyMatch[1]) {
      info.company = companyMatch[1].trim();
      break;
    }
  }

  // Notes - everything else that wasn't captured
  const capturedText = [
    info.email,
    info.phone,
    info.firstName,
    info.lastName,
    info.company
  ].filter(Boolean).join(' ');
  
  const notes = transcript
    .replace(new RegExp(capturedText, 'gi'), '')
    .replace(/(?:name is|my name is|I'm|I am|company is|works at|from|at|with)/gi, '')
    .trim();
  
  if (notes.length > 10) {
    info.notes = notes;
  }

  return info;
}
