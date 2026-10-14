import { appUrl } from './app-url.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function brandEmail(options: {
  headline: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  footnote?: string;
}): { html: string; text: string } {
  const headline = escapeHtml(options.headline);
  const body = escapeHtml(options.body);
  const buttonLabel = escapeHtml(options.buttonLabel);
  const buttonUrl = escapeHtml(options.buttonUrl);
  const footnote = escapeHtml(options.footnote || 'Sent by MarketPollen. If you were not expecting this, you can ignore it.');
  const logoUrl = `${appUrl()}/assets/sidemenu-logo-96@2x.png`;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#f6f1e4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f1e4;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:20px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="height:8px;background-color:#f5c842;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td align="center" style="padding:36px 40px 8px 40px;">
                <img src="${logoUrl}" width="72" height="72" alt="Market Pollen" style="display:block;border:0;outline:none;text-decoration:none;">
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 40px 0 40px;">
                <div style="font-size:18px;font-weight:700;letter-spacing:0.4px;color:#2d2d2d;">Market<span style="color:#d4a017;">Pollen</span></div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 0 40px;">
                <h1 style="margin:0 0 12px 0;font-size:26px;line-height:1.25;font-weight:700;color:#2d2d2d;">${headline}</h1>
                <p style="margin:0 0 28px 0;font-size:16px;line-height:1.6;color:#5c564c;">${body}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 40px 8px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:999px;background-color:#f5c842;">
                      <a href="${options.buttonUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#2d2d2d;text-decoration:none;border-radius:999px;">${buttonLabel}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 0 40px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8175;">
                  Or open this link:<br>
                  <a href="${options.buttonUrl}" style="color:#8a8175;word-break:break-all;">${buttonUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 32px 40px;">
                <p style="margin:0;padding-top:20px;border-top:1px solid #f0e6cf;font-size:12px;line-height:1.5;color:#a39888;">${footnote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${options.headline}\n\n${options.body}\n\n${options.buttonLabel}: ${options.buttonUrl}\n\n${options.footnote || 'Sent by MarketPollen.'}`;
  return { html, text };
}
