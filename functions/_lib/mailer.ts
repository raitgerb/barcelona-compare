// Login-code delivery for owner sessions (B2B Phase 1).
//
// The email transport is deliberately pluggable and optional: a Resend API key in
// the Pages project (`RESEND_API_KEY` + `EMAIL_FROM`) sends the code straight to
// the owner. Without it the code is not lost — it is logged and the operator can
// hand it to the owner over the phone or WhatsApp, which is how the rest of this
// audience is already onboarded. The API never returns a code to an anonymous
// caller (see functions/api/owner/session.ts).

export interface MailInput {
  to: string;
  code: string;
  businessName: string;
  /** Deep link back to the dashboard, e.g. https://barcelonacompare.com/gestion/?b=slug */
  manageUrl: string;
  lang: 'es' | 'en';
}

export interface MailResult {
  delivered: boolean;
  transport: 'resend' | 'none';
  error?: string;
}

export async function sendLoginCode(env: Env, input: MailInput): Promise<MailResult> {
  const apiKey = typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  const from = typeof env.EMAIL_FROM === 'string' ? env.EMAIL_FROM.trim() : '';
  if (!apiKey || !from) {
    console.log(`owner-session: no email transport configured, login code for ${input.to} is ${input.code}`);
    return { delivered: false, transport: 'none' };
  }

  const subject =
    input.lang === 'en'
      ? `Your Barcelona Compare access code: ${input.code}`
      : `Tu código de acceso a Barcelona Compare: ${input.code}`;
  const body =
    input.lang === 'en'
      ? [`Your code is ${input.code} (valid for 15 minutes).`, '', `Open your dashboard: ${input.manageUrl}`].join('\n')
      : [`Tu código es ${input.code} (válido 15 minutos).`, '', `Abre tu panel: ${input.manageUrl}`].join('\n');

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject,
        text: body,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('owner-session: resend rejected the send', response.status, detail.slice(0, 300));
      return { delivered: false, transport: 'resend', error: `resend_status_${response.status}` };
    }
    return { delivered: true, transport: 'resend' };
  } catch (error) {
    console.error('owner-session: resend request failed', error);
    return { delivered: false, transport: 'resend', error: 'resend_unreachable' };
  }
}
