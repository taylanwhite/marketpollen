import { Fragment, type ReactNode } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

/**
 * Renders the small subset of Markdown used by the legal documents:
 * # / ## headings, paragraphs, "- " bullet lists, **bold**, and [text](url) links.
 */
export function LegalDocument({ markdown }: { markdown: string }) {
  const blocks = markdown.trim().split(/\n\s*\n/);
  return (
    <Box sx={{ '& p': { lineHeight: 1.65 } }}>
      {blocks.map((block, i) => renderBlock(block.trim(), i))}
    </Box>
  );
}

function renderBlock(block: string, key: number): ReactNode {
  if (block.startsWith('# ')) {
    return (
      <Typography key={key} component="h1" variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
        {renderInline(block.slice(2))}
      </Typography>
    );
  }
  if (block.startsWith('## ')) {
    return (
      <Typography key={key} component="h2" variant="h6" sx={{ fontWeight: 700, mt: 4, mb: 1.5 }}>
        {renderInline(block.slice(3))}
      </Typography>
    );
  }
  if (block.startsWith('- ')) {
    const items = block.split(/\n(?=- )/).map((line) => line.replace(/^- /, ''));
    return (
      <Box key={key} component="ul" sx={{ pl: 3, my: 1.5 }}>
        {items.map((item, j) => (
          <Typography key={j} component="li" variant="body2" sx={{ mb: 0.75, lineHeight: 1.65 }}>
            {renderInline(item)}
          </Typography>
        ))}
      </Box>
    );
  }
  return (
    <Typography key={key} variant="body2" sx={{ mb: 1.5 }}>
      {renderInline(block)}
    </Typography>
  );
}

function renderInline(text: string): ReactNode {
  // Split on **bold** and [text](url), keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, href] = link;
      return href.startsWith('/')
        ? <Link key={i} component={RouterLink} to={href}>{label}</Link>
        : <Link key={i} href={href} target="_blank" rel="noopener noreferrer">{label}</Link>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
