import type { MailConfig } from './config.ts'

/**
 * Email, for the one thing that needs it: a dashboard sign-in's "forgot my password" link. Customers
 * are never emailed (their messages go through their wallet). Off when RESEND_API_KEY is empty: the
 * dashboard then tells people to ask us, and we reset from the command line.
 */
export interface Mail {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

/** Sends through Resend's HTTP API (resend.com). MAIL_FROM must be on a domain verified there. */
export function resendMailer(config: MailConfig, fetchFn: typeof fetch = fetch): Mailer {
  return {
    async send(mail) {
      const r = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) throw new Error(`Resend answered ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
    },
  }
}

/** The reset email, in both languages: we do not know which one the person reads. */
export function resetEmail(publicUrl: string, to: string, token: string, lang: 'ar' | 'en'): Mail {
  const link = `${publicUrl}/admin#reset=${token}`
  const en = [
    'Someone asked to reset the password for this loyalty dashboard sign-in.',
    '',
    `Choose a new password here (the link works once, for one hour):`,
    link,
    '',
    'If it was not you, ignore this email: your password stays as it is.',
  ].join('\n')
  const ar = [
    'طلب أحدهم إعادة تعيين كلمة المرور لحسابك في لوحة بطاقة الولاء.',
    '',
    'اختر كلمة مرور جديدة من هنا (يعمل الرابط مرة واحدة، ولمدة ساعة):',
    link,
    '',
    'إن لم تكن أنت، تجاهل هذه الرسالة: كلمة مرورك تبقى كما هي.',
  ].join('\n')
  const subject = lang === 'ar' ? 'إعادة تعيين كلمة المرور / Reset your password' : 'Reset your password / إعادة تعيين كلمة المرور'
  return { to, subject, text: lang === 'ar' ? `${ar}\n\n---\n\n${en}` : `${en}\n\n---\n\n${ar}` }
}
