// Claim-code delivery (B2B Phase 0).
//
// Deliberately tiny and pluggable: one optional transport. With `RESEND_API_KEY`
// and `EMAIL_FROM` configured in the Pages project the 6-digit code is mailed
// straight from the edge; without them nothing is lost — the code stays in the
// `claim_requests` row (`code_pending`) and the operator can hand it over through
// `GET /api/claim/outbox` (admin token). The HTTP API never returns a live code to
// an anonymous caller.
//
// Switching transport (Resend today, Cloudflare Email Service or any other
// transactional provider tomorrow) means adding a branch here and setting one
// secret — no schema, endpoint or UI change. See docs/claim-flow.md.

export type MailTransport = 'resend' | 'none';

export interface ClaimCodeMail {
  to: string;
  code: string;
  businessName: string;
  expiresInMinutes: number;
  lang: 'es' | 'en';
}

export interface MailResult {
  delivered: boolean;
  transport: MailTransport;
  error?: string;
}

const DEFAULT_FROM = 'Barcelona Compare <no-reply@barcelonacompare.com>';
const DEFAULT_REPLY_TO = 'hola@barcelonacompare.com';
const SEND_TIMEOUT_MS = 8_000;

/** Read an optional string env var without depending on the Env type surface. */
export function envString(env: unknown, name: string): string {
  const value = (env as Record<string, unknown> | null | undefined)?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function mailTransport(env: unknown): MailTransport {
  return envString(env, 'RESEND_API_KEY') ? 'resend' : 'none';
}

export function mailFrom(env: unknown): string {
  return envString(env, 'EMAIL_FROM') || DEFAULT_FROM;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function claimCodeSubject(mail: ClaimCodeMail): string {
  return mail.lang === 'en'
    ? `Your Barcelona Compare code to claim ${mail.businessName}: ${mail.code}`
    : `Tu código para reclamar ${mail.businessName} en Barcelona Compare: ${mail.code}`;
}

/** Plain-text body — the part that matters: the code, and what to do with it. */
export function claimCodeText(mail: ClaimCodeMail): string {
  const name = mail.businessName;
  if (mail.lang === 'en') {
    return [
      `Your verification code is ${mail.code}`,
      '',
      `Enter it on the page where you asked to claim "${name}" on Barcelona Compare.`,
      `The code is valid for ${mail.expiresInMinutes} minutes and can only be used once.`,
      '',
      "If you did not request this code, you can ignore this message: nothing happens",
      'until somebody enters the code on that page.',
      '',
      'Barcelona Compare · barcelonacompare.com',
      'We only use this address to verify that you manage the business. No newsletter,',
      'no marketing, and we never sell it.',
    ].join('\n');
  }
  return [
    `Tu código de verificación es ${mail.code}`,
    '',
    `Introdúcelo en la página donde has pedido reclamar «${name}» en Barcelona Compare.`,
    `El código es válido durante ${mail.expiresInMinutes} minutos y solo se puede usar una vez.`,
    '',
    'Si no has pedido este código, puedes ignorar este mensaje: no pasa nada hasta que',
    'alguien introduzca el código en esa página.',
    '',
    'Barcelona Compare · barcelonacompare.com',
    'Solo usamos esta dirección para verificar que gestionas el negocio. Sin boletines,',
    'sin publicidad y nunca la cedemos a terceros.',
  ].join('\n');
}

export function claimCodeHtml(mail: ClaimCodeMail): string {
  const name = escapeHtml(mail.businessName);
  const code = escapeHtml(mail.code);
  const intro =
    mail.lang === 'en'
      ? `Enter this code on the page where you asked to claim <strong>${name}</strong>:`
      : `Introduce este código en la página donde has pedido reclamar <strong>${name}</strong>:`;
  const valid =
    mail.lang === 'en'
      ? `Valid for ${mail.expiresInMinutes} minutes, single use.`
      : `Válido ${mail.expiresInMinutes} minutos, un solo uso.`;
  const ignore =
    mail.lang === 'en'
      ? 'If you did not request it, ignore this message — nothing changes until the code is entered.'
      : 'Si no lo has pedido, ignora este mensaje: nada cambia hasta que se introduzca el código.';
  const privacy =
    mail.lang === 'en'
      ? 'We use this address only to verify that you manage the business. No marketing, ever.'
      : 'Usamos esta dirección solo para verificar que gestionas el negocio. Sin publicidad.';

  return `<!doctype html>
<html lang="${mail.lang}">
  <body style="margin:0;padding:24px;background:#fafaf9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#292524;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${intro}</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;text-align:center;color:#0f172a;">${code}</p>
      <p style="margin:0 0 20px;font-size:13px;color:#78716c;">${valid}</p>
      <p style="margin:0 0 20px;font-size:13px;color:#78716c;">${ignore}</p>
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:20px 0;" />
      <p style="margin:0;font-size:12px;color:#a8a29e;">
        <a href="https://barcelonacompare.com" style="color:#a8a29e;">Barcelona Compare</a> · ${privacy}
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Try to deliver the code by email. Never throws: a failed send is a delivery
 * failure, not a failure of the claim flow — the code stays available in the
 * outbox so an operator can still complete the verification.
 */
export async function sendClaimCode(env: unknown, mail: ClaimCodeMail): Promise<MailResult> {
  const transport = mailTransport(env);
  if (transport === 'none') return { delivered: false, transport: 'none' };

  const apiKey = envString(env, 'RESEND_API_KEY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: mailFrom(env),
        to: mail.to,
        reply_to: envString(env, 'EMAIL_REPLY_TO') || DEFAULT_REPLY_TO,
        subject: claimCodeSubject(mail),
        text: claimCodeText(mail),
        html: claimCodeHtml(mail),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('claim: mail transport rejected the send', response.status, detail.slice(0, 300));
      return { delivered: false, transport, error: `resend_status_${response.status}` };
    }
    return { delivered: true, transport };
  } catch (error) {
    console.error('claim: mail transport failed', (error as Error).message);
    return { delivered: false, transport, error: 'transport_failed' };
  } finally {
    clearTimeout(timer);
  }
}
