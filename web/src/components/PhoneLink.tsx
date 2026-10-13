import { Link } from '@mui/material';

function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  return `tel:${digits || trimmed}`;
}

export function PhoneLink({
  phone,
  stopPropagation = false,
}: {
  phone: string;
  stopPropagation?: boolean;
}) {
  return (
    <Link
      href={telHref(phone)}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation();
      }}
      underline="hover"
      sx={{ color: '#1a73e8', fontWeight: 600 }}
    >
      {phone}
    </Link>
  );
}
