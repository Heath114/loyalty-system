import type { Lang, Merchant } from '../loyalty.ts'

/**
 * Every word a customer reads on the web pages (join, card, privacy, delete), in English and Arabic.
 * The Arabic is written for a Jordanian reader, not translated word for word. Wallet card wording
 * lives in pass/copy.ts.
 */

const EN = {
  switchLang: 'العربية',
  getCard: 'Get your loyalty card',
  collectStamps: 'Collect {t} stamps and get: {r}.',
  earnPoints: 'Earn points every time you pay. At {t} points you get: {r}.',
  welcomeGift: 'Join now and start with {n} {u} as a welcome gift.',
  invited: 'A friend invited you. After your first purchase you both get {n} {u}.',
  name: 'Your name',
  phone: 'Mobile number (optional)',
  birthday: 'Your birthday, for a treat on the day (optional)',
  day: 'Day',
  month: 'Month',
  consent: 'Send me offers and reminders on this card',
  join: 'Get my card',
  agree: 'By joining you accept the',
  privacyLink: 'privacy notice',
  hi: 'Hi {name}',
  stamps: 'Stamps',
  points: 'Points',
  rewardReady: 'Your reward is ready: {r}',
  rewardLine: 'Reward: {r}',
  toGo: '{n} {u} to go',
  addApple: 'Add to Apple Wallet',
  addGoogle: 'Add to Google Wallet',
  latest: 'Latest',
  showCode: 'Or show this code at the counter',
  keepLink: "Keep this page's link: it is your card if you do not use a wallet app.",
  moreRewards: 'Rewards you can choose',
  canHave: 'yours now',
  invite: 'Invite a friend',
  inviteText: 'When a friend joins with your link and makes a first purchase, you both get {n} {u}.',
  share: 'Share my link',
  copied: 'Link copied',
  history: 'Your visits and rewards',
  hVisit: 'Visit',
  hReward: 'Reward',
  hWelcome: 'Welcome gift',
  hReferral: 'Friend bonus',
  hAdjust: 'Correction by the shop',
  hUndone: 'taken back',
  offersTitle: 'Offers and reminders',
  offersOn: 'You receive offers and reminders on this card.',
  offersOff: 'You do not receive offers or reminders. Birthday wishes still come if you gave your birthday.',
  turnOff: 'Stop them',
  turnOn: 'Receive them',
  privacy: 'Privacy notice',
  deleteMine: 'Delete my card',
  deleteTitle: 'Delete your card?',
  deleteText: 'Your name, phone number and birthday will be deleted, your balance ({b}) will be lost, and the card will stop working in your wallet. This cannot be undone.',
  deleteConfirm: 'Delete my card',
  keep: 'Keep my card',
  deletedTitle: 'Your card is deleted',
  deletedText: 'Your details are gone and the card no longer works. You can remove it from your wallet too.',
  boostNow: 'Now: {l}. Every purchase earns ×{x} until {until}.',
  boostCategory: 'Now: {l}. {c} earns ×{x} until {until}.',
  stampsUnit: 'stamps',
  stampUnit: 'stamp',
  pointsUnit: 'points',
  notFound: 'This card was not found. Ask at the counter for a new link.',
  tryAgain: 'Try again',
  googleDown: 'Google Wallet is not answering',
  googleDownText: 'Please try again in a minute. Your card still works:',
  showAtCounter: 'show it at the counter',
}

type Words = typeof EN

const AR: Words = {
  switchLang: 'English',
  getCard: 'احصل على بطاقة الولاء',
  collectStamps: 'اجمع {t} طوابع واحصل على: {r}.',
  earnPoints: 'اكسب النقاط في كل مرة تدفع فيها. عند {t} نقطة تحصل على: {r}.',
  welcomeGift: 'انضم الآن وابدأ برصيد {n} {u} هديةً للترحيب.',
  invited: 'دعاك صديق للانضمام. بعد أول عملية شراء تحصلان كلاكما على {n} {u}.',
  name: 'الاسم',
  phone: 'رقم الهاتف (اختياري)',
  birthday: 'تاريخ ميلادك لهدية في يومه (اختياري)',
  day: 'اليوم',
  month: 'الشهر',
  consent: 'أرسلوا لي العروض والتذكيرات على هذه البطاقة',
  join: 'احصل على بطاقتي',
  agree: 'بانضمامك فإنك توافق على',
  privacyLink: 'إشعار الخصوصية',
  hi: 'مرحبًا {name}',
  stamps: 'الطوابع',
  points: 'النقاط',
  rewardReady: 'مكافأتك جاهزة: {r}',
  rewardLine: 'المكافأة: {r}',
  toGo: 'بقي {n} {u}',
  addApple: 'أضف إلى Apple Wallet',
  addGoogle: 'أضف إلى Google Wallet',
  latest: 'آخر الأخبار',
  showCode: 'أو أبرز هذا الرمز عند الكاونتر',
  keepLink: 'احتفظ برابط هذه الصفحة، فهو بطاقتك إن لم تستخدم تطبيق المحفظة.',
  moreRewards: 'المكافآت المتاحة',
  canHave: 'متاحة لك الآن',
  invite: 'ادعُ صديقًا',
  inviteText: 'عندما ينضم صديق عبر رابطك ويشتري لأول مرة، تحصلان كلاكما على {n} {u}.',
  share: 'شارك رابطي',
  copied: 'تم نسخ الرابط',
  history: 'زياراتك ومكافآتك',
  hVisit: 'زيارة',
  hReward: 'مكافأة',
  hWelcome: 'هدية الترحيب',
  hReferral: 'مكافأة دعوة صديق',
  hAdjust: 'تصحيح من المتجر',
  hUndone: 'أُلغيت',
  offersTitle: 'العروض والتذكيرات',
  offersOn: 'تصلك العروض والتذكيرات على هذه البطاقة.',
  offersOff: 'لا تصلك العروض ولا التذكيرات. تبقى تهنئة عيد الميلاد إن كنت أضفت تاريخ ميلادك.',
  turnOff: 'إيقافها',
  turnOn: 'تفعيلها',
  privacy: 'إشعار الخصوصية',
  deleteMine: 'احذف بطاقتي',
  deleteTitle: 'هل تريد حذف بطاقتك؟',
  deleteText: 'سيُحذف اسمك ورقم هاتفك وتاريخ ميلادك، ويضيع رصيدك ({b})، وتتوقف البطاقة في محفظتك. لا يمكن التراجع عن ذلك.',
  deleteConfirm: 'احذف بطاقتي',
  keep: 'أبقِ على بطاقتي',
  deletedTitle: 'تم حذف بطاقتك',
  deletedText: 'حُذفت بياناتك ولم تعد البطاقة تعمل. يمكنك أيضًا إزالتها من محفظتك.',
  boostNow: 'الآن: {l}. كل عملية شراء تكسبك ×{x} حتى {until}.',
  boostCategory: 'الآن: {l}. فئة {c} تكسبك ×{x} حتى {until}.',
  stampsUnit: 'طوابع',
  stampUnit: 'طابع',
  pointsUnit: 'نقطة',
  notFound: 'لم يُعثر على هذه البطاقة. اطلب رابطًا جديدًا عند الكاونتر.',
  tryAgain: 'حاول مرة أخرى',
  googleDown: 'Google Wallet لا يستجيب',
  googleDownText: 'يرجى المحاولة بعد دقيقة. بطاقتك ما زالت تعمل:',
  showAtCounter: 'أبرزها عند الكاونتر',
}

export const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
}

const WORDS: Record<Lang, Words> = { en: EN, ar: AR }

export function w(lang: Lang, key: keyof Words, vars: Record<string, string | number> = {}): string {
  let s = WORDS[lang][key]
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** "stamps", "stamp" or "points" in the language, for a number of them. */
export function unitWord(lang: Lang, m: Merchant, n: number): string {
  if (m.program === 'points') return w(lang, 'pointsUnit')
  return n === 1 ? w(lang, 'stampUnit') : w(lang, 'stampsUnit')
}

/** The merchant's own words in the reader's language, falling back to English. */
export function pick(lang: Lang, en: string, ar: string | null | undefined): string {
  return lang === 'ar' && ar ? ar : en
}

/** The usual form errors in Arabic; anything else stays as the server wrote it. */
const ERRORS_AR: [string, string][] = [
  ['Please enter your name', 'يرجى كتابة اسمك'],
  ['Please check the phone number', 'يرجى التحقق من رقم الهاتف'],
  ['Please check the email address', 'يرجى التحقق من البريد الإلكتروني'],
  ['Please check the birthday', 'يرجى التحقق من تاريخ الميلاد'],
]

export function errorText(lang: Lang, message: string): string {
  if (lang !== 'ar') return message
  return ERRORS_AR.find(([en]) => message.startsWith(en))?.[1] ?? message
}

/**
 * The privacy notice, per merchant. A plain template the merchant's own lawyer should read before the
 * first customer (docs/MANUAL_STEPS.md §12); it names the merchant as the one responsible.
 */
export function privacyNotice(lang: Lang, m: Merchant & { contact_phone?: string | null; contact_email?: string | null; contact_address?: string | null }) {
  const name = pick(lang, m.name, m.name_ar)
  const contact = [m.contact_phone, m.contact_email, m.contact_address].filter(Boolean).join(' · ')
  if (lang === 'ar') {
    return {
      title: `إشعار الخصوصية لبطاقة الولاء من ${name}`,
      sections: [
        ['من المسؤول عن بياناتك', `تدير ${name} بطاقة الولاء هذه وتقرر كيف تُستخدم بياناتك.${contact ? ` للتواصل: ${contact}.` : ' للتواصل اسأل عند الكاونتر.'}`],
        ['ما الذي نجمعه', 'اسمك، ورقم هاتفك وتاريخ ميلادك (اليوم والشهر فقط) إن أضفتهما، وزياراتك ومشترياتك المسجلة على البطاقة ومكافآتك، وموافقتك على العروض أو عدمها، ولغة هاتفك.'],
        ['لماذا', 'لتشغيل بطاقتك: الطوابع أو النقاط والمكافآت. ولإرسال الرسائل التي طلبتها على البطاقة: تهنئة عيد الميلاد إن أضفت تاريخ ميلادك، والعروض والتذكيرات فقط إن وافقت عليها. لا نرسل رسائل نصية، ولا نبيع بياناتك لأحد.'],
        ['من يطّلع عليها', 'موظفو المتجر عند تسجيل زياراتك، ومزوّد نظام البطاقة الذي يحفظ البيانات نيابةً عن المتجر ولا يستخدمها لأي غرض آخر. تعيش البطاقة في Apple Wallet أو Google Wallet، وتنقل Apple وGoogle تحديثاتها إلى هاتفك.'],
        ['إلى متى', 'ما دامت بطاقتك قائمة. عند حذفها تُمحى بياناتك الشخصية، وتبقى زياراتك في أرقام المتجر دون اسم.'],
        ['حقوقك', 'يمكنك رؤية ما نحفظه عنك في صفحة بطاقتك، وطلب تصحيحه عند الكاونتر، وإيقاف العروض والتذكيرات في أي وقت من صفحة بطاقتك، وحذف بطاقتك وبياناتك بنفسك من صفحة بطاقتك أو بطلب من المتجر.'],
      ] as [string, string][],
    }
  }
  return {
    title: `Privacy notice for the ${name} loyalty card`,
    sections: [
      ['Who is responsible for your details', `${name} runs this loyalty card and decides how your details are used.${contact ? ` Contact: ${contact}.` : ' To reach them, ask at the counter.'}`],
      ['What is collected', 'Your name; your mobile number and birthday (day and month only), if you give them; your visits, the purchases recorded on the card and your rewards; whether you agreed to offers; and your phone\'s language.'],
      ['Why', 'To run your card: stamps or points, and rewards. To send the messages you asked for on the card: birthday wishes if you gave your birthday, and offers and reminders only if you agreed to them. No text messages, and your details are never sold.'],
      ['Who sees them', 'The shop\'s staff when they record a visit, and the card system\'s provider, who stores the details for the shop and uses them for nothing else. The card lives in Apple Wallet or Google Wallet, and Apple and Google deliver its updates to your phone.'],
      ['How long', 'For as long as you keep the card. When it is deleted your personal details are wiped; your visits stay in the shop\'s numbers without a name.'],
      ['Your rights', 'You can see what is kept about you on your card page, ask at the counter to correct it, stop offers and reminders at any time from your card page, and delete your card and details yourself from your card page or by asking the shop.'],
    ] as [string, string][],
  }
}
