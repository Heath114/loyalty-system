import { rewardsAvailable, type Card, type Lang, type Location, type Merchant } from '../loyalty.ts'

/**
 * The words a customer reads, in both languages, shared by the Apple pass, the Google card and the
 * messages so the two wallets never drift apart.
 */

export function merchantName(m: Merchant, lang: Lang): string {
  return lang === 'ar' ? (m.name_ar ?? m.name) : m.name
}

export function rewardText(m: Merchant, lang: Lang): string {
  return lang === 'ar' ? (m.reward_text_ar ?? m.reward_text) : m.reward_text
}

export function howItWorks(m: Merchant, lang: Lang): string {
  const reward = rewardText(m, lang)
  if (lang === 'ar') {
    return m.program === 'stamps'
      ? `أبرز هذه البطاقة عند الكاونتر في كل زيارة لتحصل على طابع. اجمع ${m.reward_threshold} طوابع واحصل على: ${reward}.`
      : `أبرز هذه البطاقة عند الدفع. كل دينار يمنحك ${m.points_per_jod} نقطة، وعند ${m.reward_threshold} نقطة تحصل على: ${reward}.`
  }
  return m.program === 'stamps'
    ? `Show this card at the counter on every visit for a stamp. Collect ${m.reward_threshold} stamps and get: ${reward}.`
    : `Show this card at the counter when you pay. Every JOD earns ${m.points_per_jod} points. At ${m.reward_threshold} points you get: ${reward}.`
}

/** "3 stamps to go", or "Ready to redeem" once a reward is waiting. */
export function nextReward(m: Merchant, card: Card, lang: Lang): string {
  const left = m.reward_threshold - (card.balance % m.reward_threshold)
  if (rewardsAvailable(m, card) > 0) return lang === 'ar' ? 'جاهزة للاستلام' : 'Ready to redeem'
  if (lang === 'ar') return `بقي ${left} ${m.program === 'stamps' ? 'طوابع' : 'نقاط'}`
  return `${left} ${m.program === 'stamps' ? (left === 1 ? 'stamp' : 'stamps') : 'points'} to go`
}

/** Fills the space for messages on the back of the card until the first one arrives. */
export function welcome(m: Merchant, lang: Lang): string {
  return lang === 'ar'
    ? `ستظهر هنا عروض وأخبار ${merchantName(m, lang)}.`
    : `Offers and news from ${m.name} will appear here.`
}

/** What the lock screen says near a branch, unless the merchant wrote their own. */
export function nearby(m: Merchant, l: Location, lang: Lang): string {
  const own = lang === 'ar' ? (l.text_ar ?? l.text) : l.text
  if (own) return own
  return lang === 'ar'
    ? `أنت بالقرب من ${merchantName(m, lang)}. أبرز بطاقتك عند الدفع.`
    : `You're near ${m.name}. Show your card when you pay.`
}

/** Replaces {name} in a merchant's message with the member's first name. */
export function personalise(text: string, card: Card): string {
  return text.replaceAll('{name}', card.member_name.trim().split(/\s+/)[0])
}
