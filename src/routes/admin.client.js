// The merchant dashboard, in the browser. Plain DOM, no build step, every string through textContent.
;(function () {
  'use strict'

  var TOKEN_KEY = 'loyalty.adminToken'
  var LANG_KEY = 'loyalty.adminLang'
  function load(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) {} }

  var token = load(TOKEN_KEY)
  var lang = load(LANG_KEY) || (/^ar\b/i.test(navigator.language || '') ? 'ar' : 'en')
  var S = null
  var tab = 'overview'
  var reportDays = 30
  var root = document.getElementById('root')

  // ---------------------------------------------------------------------------------------------
  // Words. Arabic is written for the reader, not translated word for word.

  var T = {
    en: {
      title: 'Loyalty dashboard', signIn: 'Sign in', email: 'Email', password: 'Password', signOut: 'Sign out',
      signInHint: 'For the people who run a business\'s loyalty card.',
      setPassword: 'Choose your own password', setPasswordHint: 'You signed in with a password we made for you. Choose one only you know.',
      current: 'Current password', newPassword: 'New password', atLeast: 'At least {n} characters', savePassword: 'Save password',
      tabs_overview: 'Overview', tabs_members: 'Members', tabs_messages: 'Messages', tabs_earning: 'Earning', tabs_card: 'Card',
      tabs_branches: 'Branches', tabs_staff: 'Staff', tabs_settings: 'Settings',
      saved: 'Saved', save: 'Save', cancel: 'Cancel', remove: 'Remove', confirm: 'Tap again to confirm', edit: 'Edit', add: 'Add',
      copy: 'Copy', copied: 'Copied', open: 'Open', on: 'On', off: 'Off', none: 'None yet', yes: 'Yes', no: 'No', loading: 'Loading…',
      english: 'English', arabic: 'Arabic', sendIt: 'Send this message', optional: 'optional', days: 'days', showMore: 'Show more',
      // Overview
      last: 'Last {n} days', members: 'Members', newMembers: '{n} joined in this period', visits: 'Visits', visitors: '{n} people',
      repeat: 'Came twice or more', repeatSub: 'of people who visited', returning: 'Returning members', returningSub: 'members from before this period who came',
      redeemed: 'Rewards given', waiting: '{n} ready and not yet claimed', inWallet: 'In a wallet', inWalletSub: '{a} Apple, {g} Google',
      offers: 'Agreed to offers', offersSub: '{n} gave a birthday', spent: 'Spent (JOD)', earned: '{n} stamps or points given',
      perDay: 'Visits and new members per day', legendVisits: 'Visits', legendJoined: 'Joined',
      msgResults: 'Messages and who came back', msgResultsHint: 'Came back: members who visited within 14 days of the message. Recent messages are still counting.',
      message: 'Message', sent: 'Sent', cameBack: 'Came back', byCategory: 'What was bought', purchases: 'Purchases', amount: 'Amount (JOD)',
      units: 'Earned', byStaff: 'Who records visits', staffKey: 'Staff key', redemptions: 'Rewards given', noStaff: 'Recorded without a staff key',
      nothingYet: 'Nothing in this period yet.',
      kind_birthday: 'Birthday', kind_winback: 'Win-back', kind_promo: 'Promotion', kind_reminder: 'Reminder',
      // Members
      search: 'Search by name, phone or card number', exportCsv: 'Download all (CSV)', name: 'Name', phone: 'Phone', balance: 'Balance',
      lastVisit: 'Last visit', joined: 'Joined', cardNo: 'Card number', birthday: 'Birthday', language: 'Card language',
      membersCount: '{n} members', noMembers: 'No members found.', history: 'Visits and rewards', messagesSent: 'Messages they received',
      earn: 'Visit', redeem: 'Reward given', deleteMember: 'Delete this member',
      deleteHint: 'Only when the person asks (their right under Jordan\'s data protection law). Their name, phone and birthday are wiped, their card stops working and shows as void in their wallet. Their visits stay in your numbers, without a name. This cannot be undone.',
      deleted: 'Member deleted', close: 'Close',
      // Messages
      rules: 'Every member gets at most {d} message a day and {m} in 30 days, only between {f}:00 and {u}:00. Offers, win-back and reminders go only to members who agreed to them. {name} in a message becomes the member\'s first name.',
      birthdayMsg: 'Birthday message', birthdayHint: 'Sent on the member\'s birthday, to everyone who gave one when joining.',
      winbackMsg: 'We miss you', winbackHint: 'Sent once to a member who has not visited for this many days.', afterDays: 'After how many days (7 to 365)',
      textEn: 'Message in English', textAr: 'Message in Arabic', remindersTitle: 'Reminders after a purchase',
      remindersHint: 'Sent a number of days after a member\'s latest purchase in a category: a warranty about to end, time for the next appointment.',
      needCategories: 'Add the categories you sell in Earning first; reminders hang off them.',
      category: 'Category', daysAfter: 'Days after the purchase', addReminder: 'Add reminder', saveReminder: 'Save reminder',
      promos: 'Promotions', promosHint: 'A one-off offer to every member who agreed to offers.', when: 'When', now: 'Now', later: 'At a set time',
      sendPromo: 'Send promotion', schedulePromo: 'Schedule promotion', scheduled: 'Scheduled', cancelled: 'Cancelled', going: 'Going out',
      done: 'Sent', cancelPromo: 'Cancel',
      // Earning
      program: 'How members earn', stamps: 'Stamps', points: 'Points', stampsHint: 'One stamp per visit', pointsHint: 'Points per JOD spent',
      threshold: 'Reward at', thresholdStamps: 'Stamps for a reward', thresholdPoints: 'Points for a reward', perJod: 'Points per JOD',
      reward: 'The reward', rewardEn: 'Reward in English', rewardAr: 'Reward in Arabic', programLocked: 'The program type cannot change after the first purchase.',
      categories: 'Categories', categoriesHint: 'What you sell, each with its own way of earning. Once you add one, staff pick one for every purchase.',
      catName: 'Name in English', catNameAr: 'Name in Arabic', earnsBy: 'Earns', rate: 'Points per JOD', fixed: 'A set number per purchase',
      fixedStamps: 'Stamps per purchase', fixedPoints: 'Points per purchase', addCategory: 'Add category', saveCategory: 'Save category',
      perJodShort: '{n} per JOD', perPurchase: '{n} per purchase',
      // Card
      cardLook: 'How the card looks', businessName: 'Business name in English', businessNameAr: 'Business name in Arabic',
      background: 'Background', text: 'Text', labels: 'Labels', preview: 'Preview', previewHint: 'Close to the Apple Wallet card; Google shows the same details in its own layout.',
      images: 'Pictures', icon: 'Icon', iconHint: 'Square, at least 87 by 87. Shown with notifications.', logo: 'Logo', logoHint: 'Wide, up to 480 by 150. Top of the card.',
      square: 'Google Wallet logo', squareHint: 'Square, at least 660 by 660. Shown in a circle.', upload: 'Upload PNG', counter: 'At the counter',
      counterHint: 'Customers scan this to join. Print the poster, or use the link on Instagram and WhatsApp.', joinLink: 'Join link',
      poster: 'Print the poster', qr: 'QR code only', member: 'Member', nextReward: 'Next reward', sample: 'Lina',
      // Branches
      branches: 'Branches', branchesHint: 'Up to {n}. Near a branch the card can appear on the lock screen; Apple and Google decide when, so treat it as a bonus.',
      branchName: 'Branch name', where: 'Where', whereHint: 'Coordinates (31.9539, 35.8836) or a Google Maps link', nearText: 'Lock screen text in English',
      nearTextAr: 'Lock screen text in Arabic', addBranch: 'Add branch',
      // Staff
      staff: 'Counter devices', staffHint: 'Each phone or tablet at the counter gets its own key. Open the staff page on it and paste the key once.',
      label: 'Name', created: 'Created', lastUsed: 'Last used', never: 'Never', revoked: 'Removed', newKey: 'New key', keyFor: 'Which counter or device',
      keyOnce: 'Copy this key now. It is shown only once; if it is lost, make a new one.', staffPage: 'Staff page',
      // Settings
      account: 'Your sign-in', admins: 'People who can sign in', adminsHint: 'Everyone here can change everything on this dashboard.',
      addAdmin: 'Add person', adminName: 'Their name', tempPassword: 'Give them this password. They choose their own when they first sign in. It is shown only once.',
      you: 'you', timezone: 'Time zone', timezoneHint: 'Messages go out between 10:00 and 21:00 in this time zone.', pending: 'Has not signed in yet',
      changePassword: 'Change password',
      adjust: 'Add or take away', adjustHint: 'A purchase staff forgot to record, a goodwill gesture, a correction. A minus sign takes away. The member sees "Correction by the shop"; your reason stays here.',
      adjustUnits: 'How many (+ or -)', reason: 'Reason', adjustBtn: 'Apply', adjusted: 'Balance updated',
      k_adjust: 'Correction', k_welcome: 'Welcome gift', k_referral: 'Friend bonus', k_void: 'Undo by staff', undoneTag: 'undone',
      moreRewards: 'More rewards', moreRewardsHint: 'Besides the reward above, offer more at other prices. Staff see the ones a card can afford; the card lists them all.',
      onTheCard: 'on the card', rewardName: 'Reward in English', rewardNameAr: 'Reward in Arabic', cost: 'Cost', addReward: 'Add reward', saveReward: 'Save reward',
      gifts: 'Gifts', giftsHint: 'Each is at most one whole reward; 0 switches it off. The friend bonus is paid once the friend\'s first purchase is 10 minutes old, to both of them; a member is paid for at most 10 friends a month.',
      welcomeGift: 'Welcome gift for every new member', referralGift: 'Bring a friend: what each of them gets',
      boosts: 'Bonus periods', boostsHint: 'For a while, purchases earn more: double points this weekend, triple on accessories during Eid. At most 31 days. Tell members with a promotion.',
      boostName: 'Name in English', boostNameAr: 'Name in Arabic', multiplier: 'Multiplier', appliesTo: 'Applies to', everything: 'Every purchase',
      starts: 'Starts', ends: 'Ends', startNow: 'empty: now', addBoost: 'Plan bonus period', running: 'Running', upcoming: 'Coming', endBoost: 'End it',
      contact: 'How customers reach you', contactHint: 'Printed on your privacy notice. Have your lawyer read the notice before your first customer.',
      contactPhone: 'Phone', contactEmail: 'Email', contactAddress: 'Address', privacyPage: 'Open the privacy notice',
      friends: 'Friends who joined', friendsSub: '{n} bought something and were rewarded', topInviters: 'Members who brought friends',
      welcomeTile: 'Welcome gifts', rewardsGiven: 'Rewards given', boostResults: 'Bonus periods', boostedPurchases: 'Purchases boosted', undoneCol: 'Undone',
      friendsCol: 'Friends',
    },
    ar: {
      title: 'لوحة بطاقة الولاء', signIn: 'تسجيل الدخول', email: 'البريد الإلكتروني', password: 'كلمة المرور', signOut: 'تسجيل الخروج',
      signInHint: 'للمسؤولين عن بطاقة الولاء في المنشأة.',
      setPassword: 'اختر كلمة مرور خاصة بك', setPasswordHint: 'دخلت بكلمة مرور أعددناها لك. اختر كلمة لا يعرفها غيرك.',
      current: 'كلمة المرور الحالية', newPassword: 'كلمة المرور الجديدة', atLeast: '{n} أحرف على الأقل', savePassword: 'حفظ كلمة المرور',
      tabs_overview: 'نظرة عامة', tabs_members: 'الأعضاء', tabs_messages: 'الرسائل', tabs_earning: 'كسب النقاط', tabs_card: 'البطاقة',
      tabs_branches: 'الفروع', tabs_staff: 'الموظفون', tabs_settings: 'الإعدادات',
      saved: 'تم الحفظ', save: 'حفظ', cancel: 'إلغاء', remove: 'حذف', confirm: 'اضغط مرة أخرى للتأكيد', edit: 'تعديل', add: 'إضافة',
      copy: 'نسخ', copied: 'تم النسخ', open: 'فتح', on: 'مفعّلة', off: 'متوقفة', none: 'لا يوجد بعد', yes: 'نعم', no: 'لا', loading: 'جارٍ التحميل…',
      english: 'الإنجليزية', arabic: 'العربية', sendIt: 'إرسال هذه الرسالة', optional: 'اختياري', days: 'يومًا', showMore: 'عرض المزيد',
      last: 'آخر {n} يومًا', members: 'الأعضاء', newMembers: 'انضم {n} في هذه الفترة', visits: 'الزيارات', visitors: '{n} شخصًا',
      repeat: 'زاروا مرتين أو أكثر', repeatSub: 'من زوّار الفترة', returning: 'أعضاء عادوا', returningSub: 'أعضاء سابقون زاروا في هذه الفترة',
      redeemed: 'مكافآت مُنحت', waiting: '{n} جاهزة ولم تُستلم بعد', inWallet: 'في محفظة الهاتف', inWalletSub: '{a} في Apple و{g} في Google',
      offers: 'وافقوا على العروض', offersSub: '{n} أضافوا تاريخ ميلادهم', spent: 'قيمة المشتريات (د.أ)', earned: 'مُنح {n} من الطوابع أو النقاط',
      perDay: 'الزيارات والأعضاء الجدد يوميًا', legendVisits: 'الزيارات', legendJoined: 'انضموا',
      msgResults: 'الرسائل ومن عاد بعدها', msgResultsHint: 'عادوا: أعضاء زاروا خلال 14 يومًا من الرسالة. الرسائل الحديثة ما زالت تُحتسب.',
      message: 'الرسالة', sent: 'أُرسلت', cameBack: 'عادوا', byCategory: 'ما تم شراؤه', purchases: 'المشتريات', amount: 'القيمة (د.أ)',
      units: 'المكتسب', byStaff: 'من يسجّل الزيارات', staffKey: 'مفتاح الموظف', redemptions: 'مكافآت مُنحت', noStaff: 'سُجّلت بلا مفتاح موظف',
      nothingYet: 'لا شيء في هذه الفترة بعد.',
      kind_birthday: 'عيد الميلاد', kind_winback: 'اشتقنا إليك', kind_promo: 'عرض', kind_reminder: 'تذكير',
      search: 'ابحث بالاسم أو الهاتف أو رقم البطاقة', exportCsv: 'تنزيل الكل (CSV)', name: 'الاسم', phone: 'الهاتف', balance: 'الرصيد',
      lastVisit: 'آخر زيارة', joined: 'تاريخ الانضمام', cardNo: 'رقم البطاقة', birthday: 'تاريخ الميلاد', language: 'لغة البطاقة',
      membersCount: '{n} عضوًا', noMembers: 'لم يُعثر على أعضاء.', history: 'الزيارات والمكافآت', messagesSent: 'الرسائل التي وصلته',
      earn: 'زيارة', redeem: 'مكافأة مُنحت', deleteMember: 'حذف هذا العضو',
      deleteHint: 'فقط بطلب من صاحب البيانات (حقّه بموجب قانون حماية البيانات الشخصية الأردني). يُمحى الاسم والهاتف وتاريخ الميلاد، وتتوقف البطاقة وتظهر ملغاة في محفظته. تبقى زياراته في أرقامك دون اسم. لا يمكن التراجع عن ذلك.',
      deleted: 'تم حذف العضو', close: 'إغلاق',
      rules: 'يتلقى كل عضو رسالة واحدة في اليوم على الأكثر و{m} رسائل خلال 30 يومًا، بين الساعة {f}:00 والساعة {u}:00 فقط. لا تصل العروض ورسائل «اشتقنا إليك» والتذكيرات إلا لمن وافق عليها. تُستبدل {name} في الرسالة بالاسم الأول للعضو.',
      birthdayMsg: 'رسالة عيد الميلاد', birthdayHint: 'تُرسل في يوم ميلاد العضو، لكل من أضاف تاريخ ميلاده عند الانضمام.',
      winbackMsg: 'اشتقنا إليك', winbackHint: 'تُرسل مرة واحدة إلى العضو الذي لم يزرك منذ هذا العدد من الأيام.', afterDays: 'بعد كم يومًا (من 7 إلى 365)',
      textEn: 'الرسالة بالإنجليزية', textAr: 'الرسالة بالعربية', remindersTitle: 'تذكيرات بعد الشراء',
      remindersHint: 'تُرسل بعد عدد من الأيام من آخر شراء للعضو ضمن فئة معيّنة: كفالة توشك على الانتهاء، أو موعد الزيارة القادمة.',
      needCategories: 'أضف أولًا فئات ما تبيعه في صفحة «كسب النقاط»، فالتذكيرات مرتبطة بها.',
      category: 'الفئة', daysAfter: 'الأيام بعد الشراء', addReminder: 'إضافة تذكير', saveReminder: 'حفظ التذكير',
      promos: 'العروض', promosHint: 'عرض لمرة واحدة يصل إلى كل عضو وافق على العروض.', when: 'الموعد', now: 'الآن', later: 'في وقت محدد',
      sendPromo: 'إرسال العرض', schedulePromo: 'جدولة العرض', scheduled: 'مجدول', cancelled: 'مُلغى', going: 'قيد الإرسال',
      done: 'أُرسل', cancelPromo: 'إلغاء',
      program: 'طريقة الكسب', stamps: 'طوابع', points: 'نقاط', stampsHint: 'طابع عن كل زيارة', pointsHint: 'نقاط عن كل دينار',
      threshold: 'المكافأة عند', thresholdStamps: 'عدد الطوابع للمكافأة', thresholdPoints: 'عدد النقاط للمكافأة', perJod: 'النقاط لكل دينار',
      reward: 'المكافأة', rewardEn: 'المكافأة بالإنجليزية', rewardAr: 'المكافأة بالعربية', programLocked: 'لا يمكن تغيير نوع البرنامج بعد أول عملية شراء.',
      categories: 'الفئات', categoriesHint: 'ما تبيعه، ولكل فئة طريقتها في الكسب. بعد إضافة أول فئة يختار الموظف فئة في كل عملية شراء.',
      catName: 'الاسم بالإنجليزية', catNameAr: 'الاسم بالعربية', earnsBy: 'الكسب', rate: 'نقاط لكل دينار', fixed: 'عدد ثابت عن كل عملية شراء',
      fixedStamps: 'الطوابع عن كل عملية شراء', fixedPoints: 'النقاط عن كل عملية شراء', addCategory: 'إضافة فئة', saveCategory: 'حفظ الفئة',
      perJodShort: '{n} لكل دينار', perPurchase: '{n} عن كل عملية شراء',
      cardLook: 'مظهر البطاقة', businessName: 'اسم المنشأة بالإنجليزية', businessNameAr: 'اسم المنشأة بالعربية',
      background: 'الخلفية', text: 'النص', labels: 'العناوين', preview: 'معاينة', previewHint: 'قريبة من بطاقة Apple Wallet، وتعرض Google التفاصيل نفسها بتصميمها الخاص.',
      images: 'الصور', icon: 'الأيقونة', iconHint: 'مربعة، 87 × 87 على الأقل. تظهر مع الإشعارات.', logo: 'الشعار', logoHint: 'عريض، حتى 480 × 150. أعلى البطاقة.',
      square: 'شعار Google Wallet', squareHint: 'مربع، 660 × 660 على الأقل. يظهر داخل دائرة.', upload: 'رفع صورة PNG', counter: 'عند الكاونتر',
      counterHint: 'يمسح العملاء هذا الرمز للانضمام. اطبع الملصق، أو شارك الرابط على إنستغرام وواتساب.', joinLink: 'رابط الانضمام',
      poster: 'طباعة الملصق', qr: 'رمز QR فقط', member: 'العضو', nextReward: 'المكافأة التالية', sample: 'لينا',
      branches: 'الفروع', branchesHint: 'حتى {n} فروع. قرب الفرع قد تظهر البطاقة على شاشة القفل؛ وتحدد Apple وGoogle متى، فاعتبرها ميزة إضافية.',
      branchName: 'اسم الفرع', where: 'الموقع', whereHint: 'الإحداثيات (31.9539, 35.8836) أو رابط من خرائط Google', nearText: 'نص شاشة القفل بالإنجليزية',
      nearTextAr: 'نص شاشة القفل بالعربية', addBranch: 'إضافة فرع',
      staff: 'أجهزة الكاونتر', staffHint: 'لكل هاتف أو جهاز لوحي عند الكاونتر مفتاحه الخاص. افتح صفحة الموظفين عليه والصق المفتاح مرة واحدة.',
      label: 'الاسم', created: 'أُنشئ', lastUsed: 'آخر استخدام', never: 'لم يُستخدم', revoked: 'محذوف', newKey: 'مفتاح جديد', keyFor: 'أي كاونتر أو جهاز',
      keyOnce: 'انسخ هذا المفتاح الآن، فهو لا يظهر إلا مرة واحدة. إن ضاع أنشئ مفتاحًا جديدًا.', staffPage: 'صفحة الموظفين',
      account: 'حسابك', admins: 'من يمكنهم الدخول', adminsHint: 'كل من هنا يستطيع تغيير كل شيء في هذه اللوحة.',
      addAdmin: 'إضافة شخص', adminName: 'اسمه', tempPassword: 'أعطه كلمة المرور هذه، وسيختار كلمته الخاصة عند أول دخول. لا تظهر إلا مرة واحدة.',
      you: 'أنت', timezone: 'المنطقة الزمنية', timezoneHint: 'تُرسل الرسائل بين الساعة 10:00 والساعة 21:00 بهذا التوقيت.', pending: 'لم يدخل بعد',
      changePassword: 'تغيير كلمة المرور',
      adjust: 'إضافة أو خصم', adjustHint: 'عملية شراء نسي الموظف تسجيلها، أو بادرة لطيفة، أو تصحيح. علامة الطرح تعني خصمًا. يرى العضو «تصحيح من المتجر»، ويبقى السبب هنا.',
      adjustUnits: 'العدد (+ أو -)', reason: 'السبب', adjustBtn: 'تطبيق', adjusted: 'تم تحديث الرصيد',
      k_adjust: 'تصحيح', k_welcome: 'هدية الترحيب', k_referral: 'مكافأة دعوة صديق', k_void: 'تراجع من الموظف', undoneTag: 'أُلغي',
      moreRewards: 'مكافآت أخرى', moreRewardsHint: 'إلى جانب المكافأة أعلاه، اعرض مكافآت أخرى بأسعار مختلفة. يرى الموظف ما يكفيه رصيد البطاقة، وتعرض البطاقة القائمة كلها.',
      onTheCard: 'على البطاقة', rewardName: 'المكافأة بالإنجليزية', rewardNameAr: 'المكافأة بالعربية', cost: 'السعر', addReward: 'إضافة مكافأة', saveReward: 'حفظ المكافأة',
      gifts: 'الهدايا', giftsHint: 'كل منهما لا يتجاوز مكافأة كاملة، والصفر يوقفها. تُمنح مكافأة دعوة الصديق لكليهما بعد مرور 10 دقائق على أول عملية شراء للصديق، ولا يُكافأ العضو على أكثر من 10 أصدقاء في الشهر.',
      welcomeGift: 'هدية ترحيب لكل عضو جديد', referralGift: 'ادعُ صديقًا: ما يحصل عليه كل منهما',
      boosts: 'فترات المكافأة', boostsHint: 'لفترة محددة تكسب المشتريات أكثر: نقاط مضاعفة في عطلة نهاية الأسبوع، أو ثلاثة أضعاف على الإكسسوارات في العيد. 31 يومًا على الأكثر. أعلِم الأعضاء بعرض.',
      boostName: 'الاسم بالإنجليزية', boostNameAr: 'الاسم بالعربية', multiplier: 'المضاعف', appliesTo: 'تنطبق على', everything: 'كل المشتريات',
      starts: 'تبدأ', ends: 'تنتهي', startNow: 'فارغ: الآن', addBoost: 'جدولة فترة مكافأة', running: 'جارية', upcoming: 'قادمة', endBoost: 'إنهاؤها',
      contact: 'كيف يتواصل معك العملاء', contactHint: 'تظهر في إشعار الخصوصية. اطلب من محاميك قراءة الإشعار قبل أول عميل.',
      contactPhone: 'الهاتف', contactEmail: 'البريد الإلكتروني', contactAddress: 'العنوان', privacyPage: 'فتح إشعار الخصوصية',
      friends: 'أصدقاء انضموا', friendsSub: '{n} اشتروا وكوفئوا', topInviters: 'أعضاء دعوا أصدقاءهم',
      welcomeTile: 'هدايا الترحيب', rewardsGiven: 'المكافآت الممنوحة', boostResults: 'فترات المكافأة', boostedPurchases: 'مشتريات مضاعفة', undoneCol: 'أُلغي',
      friendsCol: 'الأصدقاء',
    }
  }

  function t(key, vars) {
    var s = (T[lang] && T[lang][key]) || T.en[key] || key
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])) })
    return s
  }

  // ---------------------------------------------------------------------------------------------
  // DOM and API helpers

  function h(tag, attrs) {
    var el = document.createElement(tag)
    var a = attrs || {}
    Object.keys(a).forEach(function (k) {
      var v = a[k]
      if (v == null || v === false) return
      if (k === 'text') el.textContent = v
      else if (k === 'class') el.className = v
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v)
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { el.style[p] = v[p] })
      else if (k === 'value') el.value = v
      else if (k === 'checked') el.checked = !!v
      else if (v === true) el.setAttribute(k, '')
      else el.setAttribute(k, v)
    })
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i])
    return el
  }
  function append(el, kid) {
    if (kid == null || kid === false) return
    if (Array.isArray(kid)) return kid.forEach(function (k) { append(el, k) })
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid)
  }

  function api(method, path, body, raw) {
    var headers = { Authorization: 'Bearer ' + token }
    var init = { method: method, headers: headers }
    if (body instanceof Blob || body instanceof ArrayBuffer) {
      headers['Content-Type'] = 'image/png'
      init.body = body
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    return fetch('/api/admin/' + path, init).then(function (r) {
      if (r.status === 401) { signedOut(); throw new Error(t('signIn')) }
      if (raw && r.ok) return r.blob()
      return r.json().catch(function () { return {} }).then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status })
        return j
      })
    })
  }

  var toastTimer = null
  function toast(msg, bad) {
    var old = document.querySelector('.toast')
    if (old) old.remove()
    var el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg)
    document.body.appendChild(el)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { el.remove() }, bad ? 6000 : 2500)
  }
  function fail(e) { toast(e.message || String(e), true) }

  /** Runs an action from a button: disabled while it runs, errors shown, then the state reloaded. */
  function act(btn, fn, okText) {
    if (btn) btn.disabled = true
    return Promise.resolve().then(fn).then(function (r) {
      return reload().then(function () {
        if (okText !== null) toast(okText || t('saved'))
        return r
      })
    }).catch(fail).finally(function () { if (btn) btn.disabled = false })
  }

  /** A destructive button asks for a second tap instead of a browser dialog. */
  function armed(label, onConfirm, cls) {
    var timer = null
    var b = h('button', { type: 'button', class: (cls || 'danger small') }, label)
    b.addEventListener('click', function () {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed')
        b.textContent = t('confirm')
        timer = setTimeout(function () { b.classList.remove('armed'); b.textContent = label }, 4000)
        return
      }
      clearTimeout(timer)
      b.classList.remove('armed')
      b.textContent = label
      onConfirm(b)
    })
    return b
  }

  function locale() { return lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB' }
  function tz() { return (S && S.merchant.timezone) || 'Asia/Amman' }
  function fmtNum(n) { return new Intl.NumberFormat(locale()).format(n || 0) }
  function fmtDate(ts) {
    if (!ts) return '-'
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz() }).format(new Date(ts))
  }
  function fmtDateTime(ts) {
    if (!ts) return '-'
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz() }).format(new Date(ts))
  }
  function fmtJod(fils) { return new Intl.NumberFormat(locale(), { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format((fils || 0) / 1000) }
  function pct(a, b) { return b ? Math.round((100 * a) / b) + '%' : '-' }
  function balanceText(n) {
    var m = S.merchant
    return m.program === 'stamps' ? Math.min(n, m.reward_threshold) + ' / ' + m.reward_threshold : fmtNum(n)
  }
  function catName(c) { return lang === 'ar' && c.name_ar ? c.name_ar : c.name }

  function hex(rgb) {
    var m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb || '')
    if (!m) return /^#[0-9a-f]{6}$/i.test(rgb || '') ? rgb : '#111111'
    return '#' + [m[1], m[2], m[3]].map(function (v) { return ('0' + Number(v).toString(16)).slice(-2) }).join('')
  }

  // ---------------------------------------------------------------------------------------------
  // Form pieces

  function field(label, input, hint) {
    var id = 'f' + Math.random().toString(36).slice(2, 9)
    input.id = id
    return h('div', null, h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, ' · ' + hint) : null), input)
  }

  /** A message box with a live character count against the limit. */
  function msgInput(value, dir) {
    var max = (S && S.limits.text) || 180
    var ta = h('textarea', { dir: dir, maxlength: String(max + 40), value: value || '' })
    var count = h('div', { class: 'count' })
    function update() { count.replaceChildren(h('span', { dir: 'ltr' }, ta.value.length + ' / ' + max)); count.classList.toggle('over', ta.value.length > max) }
    ta.addEventListener('input', update)
    update()
    var wrap = h('div', null, ta, count)
    wrap.input = ta
    return wrap
  }

  function pair(enLabel, enValue, arLabel, arValue, multiline) {
    var en = multiline ? msgInput(enValue, 'ltr') : h('input', { dir: 'ltr', value: enValue || '' })
    var ar = multiline ? msgInput(arValue, 'rtl') : h('input', { dir: 'rtl', value: arValue || '' })
    var node = h('div', { class: 'two' }, field(enLabel, en), field(arLabel, ar, t('optional')))
    node.en = function () { return (en.input || en).value }
    node.ar = function () { return (ar.input || ar).value }
    return node
  }

  function copyButton(text) {
    return h('button', {
      type: 'button', class: 'secondary small', onclick: function (e) {
        var b = e.currentTarget
        ;(navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('Clipboard not available')))
          .then(function () { b.textContent = t('copied') }).catch(fail)
      }
    }, t('copy'))
  }

  function table(heads, rows, numeric) {
    var nums = numeric || []
    return h('div', { class: 'scroll' }, h('table', null,
      h('thead', null, h('tr', null, heads.map(function (x, i) { return h('th', { class: nums.indexOf(i) >= 0 ? 'num' : null }, x) }))),
      h('tbody', null, rows)))
  }
  function td(v, num) { return h('td', { class: num === true ? 'num' : num || null }, v) }

  // ---------------------------------------------------------------------------------------------
  // Shell

  function setLang(l) {
    lang = l
    save(LANG_KEY, l)
    document.documentElement.lang = l
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'
    document.title = t('title')
    render()
  }

  function langToggle() {
    return h('button', { type: 'button', class: 'secondary small', onclick: function () { setLang(lang === 'ar' ? 'en' : 'ar') } },
      lang === 'ar' ? 'English' : 'العربية')
  }

  function signedOut() {
    token = null
    save(TOKEN_KEY, null)
    S = null
    renderLogin()
  }

  function reload() {
    return api('GET', 'state').then(function (s) { S = s })
  }

  function render() {
    if (!token) return renderLogin()
    if (!S) return
    if (S.admin.must_change) return renderSetPassword()
    renderApp()
  }

  function renderLogin(error) {
    var email = h('input', { type: 'email', autocomplete: 'username', required: true, dir: 'ltr' })
    var password = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' })
    var err = h('p', { class: 'err', role: 'alert' }, error || '')
    var btn = h('button', { type: 'submit' }, t('signIn'))
    var form = h('form', {
      class: 'panel', onsubmit: function (e) {
        e.preventDefault()
        btn.disabled = true
        err.textContent = ''
        fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value, password: password.value }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Sign in failed'); return j }) })
          .then(function (j) { token = j.token; save(TOKEN_KEY, token); return start() })
          .catch(function (e2) { err.textContent = e2.message })
          .finally(function () { btn.disabled = false })
      }
    }, h('h1', null, t('signIn')), h('p', { class: 'muted' }, t('signInHint')), field(t('email'), email), field(t('password'), password), err, btn)
    root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'lang-switch' }, langToggle()), form))
    email.focus()
  }

  function passwordForm(onDone) {
    var cur = h('input', { type: 'password', autocomplete: 'current-password', dir: 'ltr' })
    var next = h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr', minlength: String(S.limits.password) })
    var btn = h('button', { type: 'submit' }, t('savePassword'))
    return h('form', {
      onsubmit: function (e) {
        e.preventDefault()
        act(btn, function () { return api('POST', 'password', { current: cur.value, next: next.value }) }).then(function () {
          cur.value = ''
          next.value = ''
          if (onDone) onDone()
        })
      }
    }, field(t('current'), cur), field(t('newPassword'), next, t('atLeast', { n: S.limits.password })), h('div', { class: 'actions' }, btn))
  }

  function renderSetPassword() {
    root.replaceChildren(h('div', { class: 'auth' },
      h('div', { class: 'lang-switch' }, langToggle()),
      h('div', { class: 'panel' }, h('h1', null, t('setPassword')), h('p', { class: 'muted' }, t('setPasswordHint')), passwordForm(render)),
      h('button', { type: 'button', class: 'link', onclick: signOut }, t('signOut'))))
  }

  function signOut() {
    api('POST', 'logout').catch(function () {}).finally(signedOut)
  }

  var TABS = ['overview', 'members', 'messages', 'earning', 'card', 'branches', 'staff', 'settings']

  function renderApp() {
    var m = S.merchant
    var nav = h('nav', { class: 'tabs', 'aria-label': t('title') }, TABS.map(function (k) {
      return h('button', { type: 'button', 'aria-current': tab === k ? 'page' : null, onclick: function () { tab = k; renderApp(); window.scrollTo(0, 0) } }, t('tabs_' + k))
    }))
    var head = h('header', { class: 'top' },
      h('div', { class: 'bar' }, h('div', { class: 'brand' }, lang === 'ar' && m.name_ar ? m.name_ar : m.name), h('div', { class: 'spacer' }),
        langToggle(), h('button', { type: 'button', class: 'secondary small', onclick: signOut }, t('signOut'))),
      nav)
    var main = h('main')
    root.replaceChildren(head, main)
    var view = VIEWS[tab](main)
    if (view) main.appendChild(view)
    var current = nav.querySelector('[aria-current=page]')
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  // ---------------------------------------------------------------------------------------------
  // Overview

  function tile(label, value, sub) {
    return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub ? h('div', { class: 'sub' }, sub) : null)
  }

  function chart(daily) {
    var W = 720, H = 180, P = 22
    var max = Math.max(1, Math.max.apply(null, daily.map(function (d) { return Math.max(d.visits, d.joined) })))
    var n = daily.length
    var slot = (W - P) / n
    var bw = Math.max(1.5, slot * 0.38)
    var NS = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
    svg.setAttribute('class', 'chart')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', t('perDay'))
    function el(tag, attrs, text) {
      var e = document.createElementNS(NS, tag)
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]) })
      if (text != null) e.textContent = text
      svg.appendChild(e)
      return e
    }
    var base = H - P
    el('line', { x1: P, x2: W, y1: base, y2: base, stroke: 'currentColor', 'stroke-opacity': '0.15' })
    el('text', { x: 0, y: 14, 'font-size': '15' }, String(max))
    el('text', { x: 0, y: base, 'font-size': '15' }, '0')
    daily.forEach(function (d, i) {
      var x = P + i * slot + slot * 0.1
      var hv = ((H - 2 * P) * d.visits) / max
      var hj = ((H - 2 * P) * d.joined) / max
      var bar = el('rect', { x: x, y: base - hv, width: bw, height: Math.max(hv, d.visits ? 1 : 0), fill: 'var(--bar)', rx: 1 })
      bar.appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: d.date + ': ' + d.visits + ' · ' + d.joined }))
      el('rect', { x: x + bw, y: base - hj, width: bw, height: Math.max(hj, d.joined ? 1 : 0), fill: 'var(--bar2)', rx: 1 })
    })
    el('text', { x: P, y: H - 2, 'font-size': '15' }, daily[0].date.slice(5))
    el('text', { x: W, y: H - 2, 'font-size': '15', 'text-anchor': 'end' }, daily[n - 1].date.slice(5))
    // A chart in an RTL page still reads oldest to newest from the left, like a calendar strip.
    svg.setAttribute('direction', 'ltr')
    return h('div', { dir: 'ltr' }, svg)
  }

  function overview() {
    var box = h('div', null, h('p', { class: 'muted' }, t('loading')))
    var seg = h('div', { class: 'seg', role: 'group' }, [7, 30, 90].map(function (d) {
      return h('button', { type: 'button', 'aria-pressed': reportDays === d ? 'true' : 'false', onclick: function () { reportDays = d; renderApp() } }, t('last', { n: d }))
    }))
    api('GET', 'report?days=' + reportDays).then(function (r) {
      var v = r.visits
      var kids = [
        h('div', { class: 'grid' },
          tile(t('members'), fmtNum(r.members.total), t('newMembers', { n: fmtNum(r.members.joined) })),
          tile(t('visits'), fmtNum(v.count), t('visitors', { n: fmtNum(v.visitors) })),
          tile(t('repeat'), pct(v.repeat_visitors, v.visitors), t('repeatSub')),
          tile(t('returning'), fmtNum(v.returning_visitors), t('returningSub')),
          tile(t('redeemed'), fmtNum(r.rewards.redeemed), t('waiting', { n: fmtNum(r.rewards.waiting) })),
          tile(t('inWallet'), fmtNum(r.members.in_apple + r.members.in_google), t('inWalletSub', { a: fmtNum(r.members.in_apple), g: fmtNum(r.members.in_google) })),
          tile(t('offers'), fmtNum(r.members.offers), t('offersSub', { n: fmtNum(r.members.birthdays) })),
          r.referrals.joined || S.merchant.referral_units ? tile(t('friends'), fmtNum(r.referrals.joined), t('friendsSub', { n: fmtNum(r.referrals.rewarded) })) : null,
          r.welcome.members ? tile(t('welcomeTile'), fmtNum(r.welcome.members), t('earned', { n: fmtNum(r.welcome.units) })) : null,
          S.merchant.program === 'points' || v.amount_fils ? tile(t('spent'), fmtJod(v.amount_fils), t('earned', { n: fmtNum(v.units) })) : null),
        h('div', { class: 'panel' }, h('h2', null, t('perDay')), chart(r.daily),
          h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--bar)' } }), t('legendVisits')),
            h('span', null, h('i', { style: { background: 'var(--bar2)' } }), t('legendJoined')))),
        h('div', { class: 'panel' }, h('h2', null, t('msgResults')), h('p', { class: 'muted small' }, t('msgResultsHint')),
          r.messages.length
            ? table([t('message'), t('sent'), t('cameBack'), ''], r.messages.map(function (x) {
              return h('tr', null, td(h('span', null, h('span', { class: 'badge' }, t('kind_' + x.kind)), ' ', x.kind === 'birthday' || x.kind === 'winback' ? '' : h('span', { dir: 'auto' }, x.label)), 'text'),
                td(fmtNum(x.sent), true), td(fmtNum(x.came_back), true), td(pct(x.came_back, x.sent), true))
            }), [1, 2, 3])
            : h('p', { class: 'empty' }, t('nothingYet')))
      ]
      if (r.categories.length) {
        kids.push(h('div', { class: 'panel' }, h('h2', null, t('byCategory')), table([t('category'), t('purchases'), t('amount'), t('units')],
          r.categories.map(function (c) { return h('tr', null, td(catName(c)), td(fmtNum(c.purchases), true), td(fmtJod(c.amount_fils), true), td(fmtNum(c.units), true)) }), [1, 2, 3])))
      }
      if (r.rewards.given.length > 1 || r.rewards.redeemed) {
        kids.push(h('div', { class: 'panel' }, h('h2', null, t('rewardsGiven')), table([t('reward'), t('redeemed')],
          r.rewards.given.map(function (g) { return h('tr', null, td(lang === 'ar' && g.name_ar ? g.name_ar : g.name), td(fmtNum(g.count), true)) }), [1])))
      }
      if (r.boosts.length) {
        kids.push(h('div', { class: 'panel' }, h('h2', null, t('boostResults')), table([t('boosts'), t('when'), t('boostedPurchases')],
          r.boosts.map(function (b) { return h('tr', null, td(b.label + ' ×' + b.multiplier + (b.cancelled ? ' (' + t('cancelled') + ')' : '')), td(fmtDateTime(b.starts_at) + ' → ' + fmtDateTime(b.ends_at), 'nowrap'), td(fmtNum(b.purchases), true)) }), [2])))
      }
      if (r.referrals.top.length) {
        kids.push(h('div', { class: 'panel' }, h('h2', null, t('topInviters')), table([t('name'), t('friendsCol')],
          r.referrals.top.map(function (x) { return h('tr', null, td(x.name), td(fmtNum(x.friends), true)) }), [1])))
      }
      var staffRows = r.staff.filter(function (s) { return s.visits || s.redemptions || s.undone || !s.revoked }).map(function (s) {
        return h('tr', null, td(s.label + (s.revoked ? ' (' + t('revoked') + ')' : '')), td(fmtNum(s.visits), true), td(fmtNum(s.redemptions), true), td(fmtNum(s.undone), true), td(s.last_used_at ? fmtDateTime(s.last_used_at) : t('never'), true))
      })
      if (r.unattributed_visits) staffRows.push(h('tr', null, td(h('span', { class: 'muted' }, t('noStaff'))), td(fmtNum(r.unattributed_visits), true), td(''), td(''), td('')))
      kids.push(h('div', { class: 'panel' }, h('h2', null, t('byStaff')),
        staffRows.length ? table([t('staffKey'), t('visits'), t('redemptions'), t('undoneCol'), t('lastUsed')], staffRows, [1, 2, 3, 4]) : h('p', { class: 'empty' }, t('none'))))
      box.replaceChildren.apply(box, kids)
    }).catch(fail)
    return h('div', null, h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_overview'))), seg), box)
  }

  // ---------------------------------------------------------------------------------------------
  // Members

  function pickName(o, en, ar) { return lang === 'ar' && o[ar] ? o[ar] : o[en] }
  function historyWhat(l) {
    if (l.kind === 'earn') return l.category ? pickName(l, 'category', 'category_ar') : t('earn')
    if (l.kind === 'redeem') return t('redeem') + (l.reward ? ': ' + pickName(l, 'reward', 'reward_ar') : '')
    if (l.kind === 'bonus') return l.note === 'referral' ? t('k_referral') : t('k_welcome')
    if (l.kind === 'adjust') return t('k_adjust') + (l.note ? ': ' + l.note : '')
    return t('k_void')
  }

  var memberQuery = ''
  function membersView() {
    var list = h('div')
    var detail = h('div')
    var offset = 0
    var q = h('input', { type: 'search', placeholder: t('search'), value: memberQuery, 'aria-label': t('search') })
    var timer = null
    q.addEventListener('input', function () {
      clearTimeout(timer)
      timer = setTimeout(function () { memberQuery = q.value; offset = 0; fetchPage(false) }, 300)
    })
    var rowsBody = null
    var countEl = h('p', { class: 'muted small' })
    function fetchPage(more) {
      api('GET', 'members?limit=50&offset=' + offset + '&q=' + encodeURIComponent(memberQuery)).then(function (r) {
        countEl.textContent = t('membersCount', { n: fmtNum(r.total) })
        var rows = r.rows.map(function (x) {
          return h('tr', { class: 'click', tabindex: '0', onclick: function () { showMember(x.serial) }, onkeydown: function (e) { if (e.key === 'Enter') showMember(x.serial) } },
            td(x.member_name), td(h('span', { dir: 'ltr' }, x.member_phone || '-')), td(balanceText(x.balance), true), td(fmtNum(x.visits), true),
            td(fmtDate(x.last_visit), true), h('td', { class: 'num hide-sm' }, fmtDate(x.created_at)))
        })
        if (!more) {
          rowsBody = h('tbody', null, rows)
          list.replaceChildren(r.total
            ? h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, [t('name'), t('phone'), t('balance'), t('visits'), t('lastVisit')].map(function (x, i) {
              return h('th', { class: i >= 2 ? 'num' : null }, x)
            }), h('th', { class: 'num hide-sm' }, t('joined')))), rowsBody))
            : h('p', { class: 'empty' }, t('noMembers')))
        } else {
          rows.forEach(function (row) { rowsBody.appendChild(row) })
        }
        var moreBtn = list.querySelector('.more')
        if (moreBtn) moreBtn.remove()
        if (offset + r.rows.length < r.total) {
          list.appendChild(h('div', { class: 'actions more' }, h('button', { type: 'button', class: 'secondary', onclick: function () { offset += 50; fetchPage(true) } }, t('showMore'))))
        }
      }).catch(fail)
    }
    function showMember(serial) {
      api('GET', 'members/' + serial).then(function (r) {
        var x = r.member
        var lines = r.history.map(function (l) {
          var what = historyWhat(l)
          if (l.voided_at) what += ' (' + t('undoneTag') + ')'
          return h('tr', { class: l.voided_at ? 'muted' : null }, td(fmtDateTime(l.created_at), 'nowrap'), td(what), td((l.units > 0 ? '+' : '') + fmtNum(l.units), true), td(l.amount_fils ? fmtJod(l.amount_fils) : '', true))
        })
        var units = h('input', { type: 'number', step: '1', dir: 'ltr' })
        var reason = h('input', { maxlength: '120' })
        var abtn = h('button', { type: 'submit' }, t('adjustBtn'))
        var adjustForm = h('form', {
          class: 'detail', onsubmit: function (e) {
            e.preventDefault()
            act(abtn, function () { return api('POST', 'members/' + x.serial + '/adjust', { units: Number(units.value), note: reason.value }) }, t('adjusted')).then(function (res) { if (res) { showMember(x.serial); fetchPage(false) } })
          }
        }, h('h3', { style: { marginTop: '0' } }, t('adjust')), h('p', { class: 'muted small' }, t('adjustHint')),
          h('div', { class: 'two' }, field(t('adjustUnits'), units), field(t('reason'), reason)), h('div', { class: 'actions' }, abtn))
        var msgs = r.messages.map(function (m) { return h('tr', null, td(fmtDateTime(m.created_at), 'nowrap'), td(h('span', { class: 'badge' }, t('kind_' + m.kind))), td(h('span', { dir: 'auto' }, m.text), 'text')) })
        detail.replaceChildren(h('div', { class: 'panel' },
          h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h2', null, x.member_name)),
            h('button', { type: 'button', class: 'secondary small', onclick: function () { detail.replaceChildren() } }, t('close'))),
          h('dl', { class: 'facts' },
            h('dt', null, t('cardNo')), h('dd', null, h('span', { dir: 'ltr' }, x.serial.match(/.{4}/g).join(' '))),
            h('dt', null, t('phone')), h('dd', null, h('span', { dir: 'ltr' }, x.member_phone || '-')),
            h('dt', null, t('email')), h('dd', null, h('span', { dir: 'ltr' }, x.member_email || '-')),
            h('dt', null, t('birthday')), h('dd', null, x.birthday || '-'),
            h('dt', null, t('offers')), h('dd', null, x.marketing_consent ? t('yes') : t('no')),
            h('dt', null, t('language')), h('dd', null, x.lang === 'ar' ? t('arabic') : t('english')),
            h('dt', null, t('balance')), h('dd', null, balanceText(x.balance)),
            h('dt', null, t('joined')), h('dd', null, fmtDate(x.created_at)),
            h('dt', null, t('inWallet')), h('dd', null, [x.in_apple ? 'Apple' : null, x.in_google ? 'Google' : null].filter(Boolean).join(', ') || '-')),
          h('h3', null, t('history')),
          lines.length ? table(['', '', t('units'), t('amount')], lines, [2, 3]) : h('p', { class: 'empty' }, t('none')),
          h('h3', null, t('messagesSent')),
          msgs.length ? table(['', '', t('message')], msgs) : h('p', { class: 'empty' }, t('none')),
          adjustForm,
          h('div', { class: 'detail' }, h('p', { class: 'muted small' }, t('deleteHint')),
            armed(t('deleteMember'), function (b) {
              act(b, function () { return api('DELETE', 'members/' + x.serial) }, t('deleted')).then(function () { detail.replaceChildren(); fetchPage(false) })
            }))))
        detail.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }).catch(fail)
    }
    function download() {
      api('GET', 'members.csv', undefined, true).then(function (blob) {
        var url = URL.createObjectURL(blob)
        var a = h('a', { href: url, download: S.merchant.slug + '-members.csv' })
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(function () { URL.revokeObjectURL(url) }, 5000)
      }).catch(fail)
    }
    fetchPage(false)
    return h('div', null,
      h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_members'))),
        h('button', { type: 'button', class: 'secondary small', onclick: download }, t('exportCsv'))),
      detail, q, countEl, list)
  }

  // ---------------------------------------------------------------------------------------------
  // Messages

  function triggerPanel(kind, title, hint) {
    var cur = S.triggers.filter(function (x) { return x.kind === kind })[0] || { enabled: 0, text: '', text_ar: '', days: 30 }
    var on = h('input', { type: 'checkbox', checked: !!cur.enabled })
    var texts = pair(t('textEn'), cur.text, t('textAr'), cur.text_ar, true)
    var days = kind === 'winback' ? h('input', { type: 'number', min: '7', max: '365', value: cur.days || 30 }) : null
    var btn = h('button', { type: 'submit' }, t('save'))
    return h('form', {
      class: 'panel', onsubmit: function (e) {
        e.preventDefault()
        act(btn, function () {
          return api('PUT', 'triggers/' + kind, { enabled: on.checked, text: texts.en(), text_ar: texts.ar(), days: days ? Number(days.value) : null })
        })
      }
    }, h('h2', null, title), h('p', { class: 'muted small' }, hint),
      h('label', { class: 'check' }, on, t('sendIt')),
      days ? field(t('afterDays'), days) : null, texts, h('div', { class: 'actions' }, btn))
  }

  function remindersPanel() {
    var cats = S.categories
    var panel = h('div', { class: 'panel' }, h('h2', null, t('remindersTitle')), h('p', { class: 'muted small' }, t('remindersHint')))
    if (!cats.length && !S.reminders.length) {
      panel.appendChild(h('p', { class: 'note' }, t('needCategories')))
      return panel
    }
    var editing = null
    var cat = h('select', null, cats.map(function (c) { return h('option', { value: String(c.id) }, catName(c)) }))
    var days = h('input', { type: 'number', min: '1', max: '1095', value: '30' })
    var texts = pair(t('textEn'), '', t('textAr'), '', true)
    var on = h('input', { type: 'checkbox', checked: true })
    var btn = h('button', { type: 'submit' }, t('addReminder'))
    var cancel = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: function () { renderApp() } }, t('cancel'))
    var form = h('form', {
      onsubmit: function (e) {
        e.preventDefault()
        var body = { category_id: Number(cat.value), days: Number(days.value), text: texts.en(), text_ar: texts.ar(), enabled: on.checked }
        act(btn, function () { return editing ? api('PUT', 'reminders/' + editing, body) : api('POST', 'reminders', body) }).then(function (r) { if (r) renderApp() })
      }
    }, h('div', { class: 'two' }, field(t('category'), cat), field(t('daysAfter'), days)), texts,
      h('label', { class: 'check' }, on, t('sendIt')), h('div', { class: 'actions' }, btn, cancel))
    var rows = S.reminders.map(function (r) {
      return h('tr', null, td(lang === 'ar' && r.category_ar ? r.category_ar : r.category), td(fmtNum(r.days), true), td(h('span', { dir: 'auto' }, r.text), 'text'), td(h('span', { class: 'badge' + (r.enabled ? ' on' : '') }, r.enabled ? t('on') : t('off'))),
        td(fmtNum(r.sent), true),
        td(h('span', { class: 'actions', style: { marginTop: '0' } },
          h('button', {
            type: 'button', class: 'secondary small', onclick: function () {
              editing = r.id
              cat.value = String(r.category_id)
              days.value = String(r.days)
              form.querySelectorAll('textarea')[0].value = r.text
              form.querySelectorAll('textarea')[1].value = r.text_ar || ''
              on.checked = !!r.enabled
              btn.textContent = t('saveReminder')
              cancel.hidden = false
              form.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, t('edit')),
          armed(t('remove'), function (b) { act(b, function () { return api('DELETE', 'reminders/' + r.id) }).then(renderApp) }))))
    })
    if (rows.length) panel.appendChild(table([t('category'), t('days'), t('message'), '', t('sent'), ''], rows, [1, 4]))
    if (cats.length) panel.appendChild(form)
    return panel
  }

  function promosPanel() {
    var texts = pair(t('textEn'), '', t('textAr'), '', true)
    var whenNow = h('input', { type: 'radio', name: 'when', value: 'now', checked: true })
    var whenLater = h('input', { type: 'radio', name: 'when', value: 'later' })
    var at = h('input', { type: 'datetime-local', disabled: true })
    var btn = h('button', { type: 'submit' }, t('sendPromo'))
    function sync() { at.disabled = !whenLater.checked; btn.textContent = whenLater.checked ? t('schedulePromo') : t('sendPromo') }
    whenNow.addEventListener('change', sync)
    whenLater.addEventListener('change', sync)
    var now = Date.now()
    var rows = S.campaigns.map(function (c) {
      var status = c.cancelled_at ? t('cancelled') : c.send_at > now ? t('scheduled') : c.send_at > now - 48 * 3600e3 ? t('going') : t('done')
      var canCancel = !c.cancelled_at && c.send_at > now - 48 * 3600e3
      return h('tr', null, td(fmtDateTime(c.send_at), 'nowrap'), td(h('span', { dir: 'auto' }, c.text), 'text'), td(h('span', { class: 'badge' }, status)), td(fmtNum(c.sent), true),
        td(canCancel ? armed(t('cancelPromo'), function (b) { act(b, function () { return api('DELETE', 'campaigns/' + c.id) }).then(renderApp) }) : ''))
    })
    return h('div', { class: 'panel' }, h('h2', null, t('promos')), h('p', { class: 'muted small' }, t('promosHint')),
      h('form', {
        onsubmit: function (e) {
          e.preventDefault()
          var when = whenLater.checked && at.value ? at.value.replace('T', ' ') : null
          act(btn, function () { return api('POST', 'campaigns', { text: texts.en(), text_ar: texts.ar(), at: when }) }).then(function (r) { if (r) renderApp() })
        }
      }, texts, h('label', null, t('when')),
        h('div', { class: 'radios' }, h('label', { class: 'radio' }, whenNow, t('now')), h('label', { class: 'radio' }, whenLater, t('later'))),
        at, h('div', { class: 'actions' }, btn)),
      rows.length ? h('div', { style: { marginTop: '16px' } }, table([t('when'), t('message'), '', t('sent'), ''], rows, [3])) : null)
  }

  function messagesView() {
    var L = S.limits
    return h('div', null, h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_messages')))),
      h('p', { class: 'note' }, t('rules', { d: L.per_day, m: L.per_30_days, f: L.hours.from, u: L.hours.until, name: '{name}' })),
      triggerPanel('birthday', t('birthdayMsg'), t('birthdayHint')),
      triggerPanel('winback', t('winbackMsg'), t('winbackHint')),
      remindersPanel(),
      promosPanel())
  }

  // ---------------------------------------------------------------------------------------------
  // Earning

  function earningView() {
    var m = S.merchant
    var program = h('select', { disabled: m.has_purchases },
      h('option', { value: 'stamps' }, t('stamps') + ': ' + t('stampsHint')), h('option', { value: 'points' }, t('points') + ': ' + t('pointsHint')))
    program.value = m.program
    var threshold = h('input', { type: 'number', min: '1', value: String(m.reward_threshold) })
    var rate = h('input', { type: 'number', min: '0', step: '0.1', value: String(m.points_per_jod) })
    var rateRow = field(t('perJod'), rate)
    var rewards = pair(t('rewardEn'), m.reward_text, t('rewardAr'), m.reward_text_ar)
    var thresholdField = field(m.program === 'stamps' ? t('thresholdStamps') : t('thresholdPoints'), threshold)
    function sync() { rateRow.hidden = program.value !== 'points' }
    program.addEventListener('change', sync)
    sync()
    var btn = h('button', { type: 'submit' }, t('save'))
    var programPanel = h('form', {
      class: 'panel', onsubmit: function (e) {
        e.preventDefault()
        var body = { program: program.value, reward_threshold: Number(threshold.value), reward_text: rewards.en(), reward_text_ar: rewards.ar() }
        if (program.value === 'points') body.points_per_jod = Number(rate.value)
        act(btn, function () { return api('PUT', 'merchant', body) }).then(function (r) { if (r) renderApp() })
      }
    }, h('h2', null, t('program')), field(t('program'), program), m.has_purchases ? h('p', { class: 'muted small' }, t('programLocked')) : null,
      h('div', { class: 'two' }, thresholdField, rateRow), h('h3', null, t('reward')), rewards, h('div', { class: 'actions' }, btn))

    // Categories
    var editing = null
    var name = h('input', { dir: 'ltr' })
    var nameAr = h('input', { dir: 'rtl' })
    var earnBy = h('select', null, m.program === 'points' ? h('option', { value: 'rate' }, t('rate')) : null, h('option', { value: 'fixed' }, t('fixed')))
    var amount = h('input', { type: 'number', min: '0', step: 'any', value: m.program === 'points' ? String(m.points_per_jod) : '1' })
    var amountLabel = h('label', null)
    function syncEarn() { amountLabel.textContent = earnBy.value === 'rate' ? t('rate') : m.program === 'stamps' ? t('fixedStamps') : t('fixedPoints') }
    earnBy.addEventListener('change', syncEarn)
    syncEarn()
    var cbtn = h('button', { type: 'submit' }, t('addCategory'))
    var ccancel = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: function () { renderApp() } }, t('cancel'))
    amount.id = 'catAmount'
    amountLabel.setAttribute('for', 'catAmount')
    var catForm = h('form', {
      onsubmit: function (e) {
        e.preventDefault()
        var body = { name: name.value, name_ar: nameAr.value, earn: earnBy.value }
        if (earnBy.value === 'rate') body.points_per_jod = Number(amount.value)
        else body.fixed_units = Number(amount.value)
        act(cbtn, function () { return editing ? api('PUT', 'categories/' + editing, body) : api('POST', 'categories', body) }).then(function (r) { if (r) renderApp() })
      }
    }, h('div', { class: 'two' }, field(t('catName'), name), field(t('catNameAr'), nameAr, t('optional'))),
      h('div', { class: 'two' }, field(t('earnsBy'), earnBy), h('div', null, amountLabel, amount)),
      h('div', { class: 'actions' }, cbtn, ccancel))
    var rows = S.categories.map(function (c) {
      return h('tr', null, td(c.name), td(h('span', { dir: 'rtl' }, c.name_ar || '')),
        td(c.earn === 'rate' ? t('perJodShort', { n: c.points_per_jod }) : t('perPurchase', { n: c.fixed_units })),
        td(h('span', { class: 'actions', style: { marginTop: '0' } },
          h('button', {
            type: 'button', class: 'secondary small', onclick: function () {
              editing = c.id
              name.value = c.name
              nameAr.value = c.name_ar || ''
              earnBy.value = c.earn
              amount.value = String(c.earn === 'rate' ? c.points_per_jod : c.fixed_units)
              syncEarn()
              cbtn.textContent = t('saveCategory')
              ccancel.hidden = false
              catForm.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, t('edit')),
          armed(t('remove'), function (b) { act(b, function () { return api('DELETE', 'categories/' + c.id) }).then(renderApp) }))))
    })
    var catPanel = h('div', { class: 'panel' }, h('h2', null, t('categories')), h('p', { class: 'muted small' }, t('categoriesHint')),
      rows.length ? table([t('catName'), t('catNameAr'), t('earnsBy'), ''], rows) : null, catForm)
    return h('div', null, h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_earning')))), programPanel, moreRewardsPanel(), giftsPanel(), catPanel, boostsPanel())
  }

  function unitName() { return S.merchant.program === 'stamps' ? t('stamps') : t('points') }

  function moreRewardsPanel() {
    var m = S.merchant
    var editing = null
    var nm = h('input', { dir: 'ltr' })
    var nmAr = h('input', { dir: 'rtl' })
    var cost = h('input', { type: 'number', min: '1', step: '1', dir: 'ltr' })
    var btn = h('button', { type: 'submit' }, t('addReward'))
    var cancel = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: function () { renderApp() } }, t('cancel'))
    var form = h('form', {
      onsubmit: function (e) {
        e.preventDefault()
        var body = { name: nm.value, name_ar: nmAr.value, cost: Number(cost.value) }
        act(btn, function () { return editing ? api('PUT', 'rewards/' + editing, body) : api('POST', 'rewards', body) }).then(function (r) { if (r) renderApp() })
      }
    }, h('div', { class: 'two' }, field(t('rewardName'), nm), field(t('rewardNameAr'), nmAr, t('optional'))),
      field(t('cost') + ' (' + unitName() + ')', cost), h('div', { class: 'actions' }, btn, cancel))
    var rows = [h('tr', null, td(pickName(m, 'reward_text', 'reward_text_ar')), td(fmtNum(m.reward_threshold), true), td(h('span', { class: 'badge' }, t('onTheCard'))))]
      .concat(S.rewards.map(function (r) {
        return h('tr', null, td(pickName(r, 'name', 'name_ar')), td(fmtNum(r.cost), true),
          td(h('span', { class: 'actions', style: { marginTop: '0' } },
            h('button', {
              type: 'button', class: 'secondary small', onclick: function () {
                editing = r.id
                nm.value = r.name
                nmAr.value = r.name_ar || ''
                cost.value = String(r.cost)
                btn.textContent = t('saveReward')
                cancel.hidden = false
                form.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }, t('edit')),
            armed(t('remove'), function (b) { act(b, function () { return api('DELETE', 'rewards/' + r.id) }).then(renderApp) }))))
      }))
    return h('div', { class: 'panel' }, h('h2', null, t('moreRewards')), h('p', { class: 'muted small' }, t('moreRewardsHint')),
      table([t('reward'), t('cost'), ''], rows, [1]), form)
  }

  function giftsPanel() {
    var m = S.merchant
    var welcome = h('input', { type: 'number', min: '0', step: '1', dir: 'ltr', value: String(m.welcome_units) })
    var friend = h('input', { type: 'number', min: '0', step: '1', dir: 'ltr', value: String(m.referral_units) })
    var btn = h('button', { type: 'submit' }, t('save'))
    return h('form', {
      class: 'panel', onsubmit: function (e) {
        e.preventDefault()
        act(btn, function () { return api('PUT', 'merchant', { welcome_units: Number(welcome.value), referral_units: Number(friend.value) }) })
      }
    }, h('h2', null, t('gifts')), h('p', { class: 'muted small' }, t('giftsHint')),
      h('div', { class: 'two' }, field(t('welcomeGift') + ' (' + unitName() + ')', welcome), field(t('referralGift') + ' (' + unitName() + ')', friend)),
      h('div', { class: 'actions' }, btn))
  }

  function boostsPanel() {
    var names = pair(t('boostName'), '', t('boostNameAr'), '')
    var mult = h('select', { dir: 'ltr' }, ['1.5', '2', '3'].map(function (x) { return h('option', { value: x }, '×' + x) }))
    mult.value = '2'
    var cat = h('select', null, h('option', { value: '' }, t('everything')), S.categories.map(function (c) { return h('option', { value: String(c.id) }, catName(c)) }))
    var starts = h('input', { type: 'datetime-local' })
    var ends = h('input', { type: 'datetime-local', required: true })
    var btn = h('button', { type: 'submit' }, t('addBoost'))
    var now = Date.now()
    var rows = S.boosts.map(function (b) {
      var on = b.starts_at <= now
      return h('tr', null, td(pickName(b, 'label', 'label_ar') + ' ×' + b.multiplier), td(b.category || t('everything')),
        td(fmtDateTime(b.starts_at) + ' → ' + fmtDateTime(b.ends_at), 'nowrap'),
        td(h('span', { class: 'badge' + (on ? ' on' : '') }, on ? t('running') : t('upcoming'))), td(fmtNum(b.purchases), true),
        td(armed(t('endBoost'), function (x) { act(x, function () { return api('DELETE', 'boosts/' + b.id) }).then(renderApp) })))
    })
    return h('div', { class: 'panel' }, h('h2', null, t('boosts')), h('p', { class: 'muted small' }, t('boostsHint')),
      rows.length ? table([t('boosts'), t('appliesTo'), t('when'), '', t('boostedPurchases'), ''], rows, [4]) : null,
      h('form', {
        onsubmit: function (e) {
          e.preventDefault()
          var body = {
            label: names.en(), label_ar: names.ar(), multiplier: Number(mult.value), category_id: cat.value ? Number(cat.value) : null,
            starts: starts.value ? starts.value.replace('T', ' ') : null, ends: ends.value.replace('T', ' ')
          }
          act(btn, function () { return api('POST', 'boosts', body) }).then(function (r) { if (r) renderApp() })
        }
      }, names, h('div', { class: 'two' }, field(t('multiplier'), mult), field(t('appliesTo'), cat)),
        h('div', { class: 'two' }, field(t('starts'), starts, t('startNow')), field(t('ends'), ends)), h('div', { class: 'actions' }, btn)))
  }

  // ---------------------------------------------------------------------------------------------
  // Card

  // The words on the card itself, as src/pass/build.ts writes them.
  var PASS_WORDS = {
    en: { rewards: 'Rewards', stamps: 'Stamps', points: 'Points', member: 'Member', next: 'Next reward', togo: function (n, p) { return n + (p === 'stamps' ? (n === 1 ? ' stamp' : ' stamps') : ' points') + ' to go' } },
    ar: { rewards: 'المكافآت', stamps: 'الطوابع', points: 'النقاط', member: 'العضو', next: 'المكافأة التالية', togo: function (n, p) { return 'بقي ' + n + (p === 'stamps' ? ' طوابع' : ' نقاط') } }
  }

  var imageUrls = {}
  function imageThumb(slot, img) {
    if (!S.images[slot]) { img.removeAttribute('src'); return }
    api('GET', 'images/' + slot, undefined, true).then(function (blob) {
      if (imageUrls[slot]) URL.revokeObjectURL(imageUrls[slot])
      imageUrls[slot] = URL.createObjectURL(blob)
      img.src = imageUrls[slot]
    }).catch(function () {})
  }

  function cardView() {
    var m = S.merchant
    var names = pair(t('businessName'), m.name, t('businessNameAr'), m.name_ar)
    var bg = h('input', { type: 'color', value: hex(m.bg_color) })
    var fg = h('input', { type: 'color', value: hex(m.fg_color) })
    var lb = h('input', { type: 'color', value: hex(m.label_color) })
    var logoImg = h('img', { alt: '' })
    var nameEl = h('span')
    var pass = h('div', { class: 'pass', dir: lang === 'ar' ? 'rtl' : 'ltr' })
    function paint() {
      pass.style.background = bg.value
      pass.style.color = fg.value
      var label = function (x) { return h('div', { class: 'lbl', style: { color: lb.value } }, x) }
      nameEl.textContent = (lang === 'ar' && names.ar()) || names.en() || m.name
      var bal = m.program === 'stamps' ? '3 / ' + m.reward_threshold : '250'
      var P = PASS_WORDS[lang]
      var left = m.program === 'stamps' ? m.reward_threshold - 3 : Math.max(0, m.reward_threshold - 250)
      pass.replaceChildren(
        h('div', { class: 'row' }, h('div', { class: 'logo' }, S.images.logo ? logoImg : null, nameEl), h('div', null, label(P.rewards), h('div', { class: 'val' }, '0'))),
        h('div', null, label(m.program === 'stamps' ? P.stamps : P.points), h('div', { class: 'big' }, h('span', { dir: 'ltr' }, bal))),
        h('div', { class: 'row' }, h('div', null, label(P.member), h('div', { class: 'val' }, t('sample'))),
          h('div', null, label(P.next), h('div', { class: 'val' }, P.togo(left, m.program)))))
    }
    ;[bg, fg, lb].forEach(function (x) { x.addEventListener('input', paint) })
    names.addEventListener('input', paint)
    imageThumb('logo', logoImg)
    paint()
    var btn = h('button', { type: 'submit' }, t('save'))
    var look = h('form', {
      class: 'panel', onsubmit: function (e) {
        e.preventDefault()
        act(btn, function () { return api('PUT', 'merchant', { name: names.en(), name_ar: names.ar(), bg_color: bg.value, fg_color: fg.value, label_color: lb.value }) })
          .then(function (r) { if (r) renderApp() })
      }
    }, h('h2', null, t('cardLook')), names,
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(3,minmax(0,1fr))' } }, field(t('background'), bg), field(t('text'), fg), field(t('labels'), lb)),
      h('h3', null, t('preview')), pass, h('p', { class: 'muted small' }, t('previewHint')), h('div', { class: 'actions' }, btn))

    function slot(key, title, hint) {
      var img = h('img', { alt: '' })
      imageThumb(key, img)
      var input = h('input', { type: 'file', accept: 'image/png', hidden: true })
      var up = h('button', { type: 'button', class: 'secondary small', onclick: function () { input.click() } }, t('upload'))
      input.addEventListener('change', function () {
        var f = input.files && input.files[0]
        if (!f) return
        act(up, function () { return f.arrayBuffer().then(function (buf) { return api('POST', 'images/' + key, buf) }) }).then(function (r) { if (r) renderApp() })
      })
      var size = S.images[key]
      return h('div', { class: 'img-slot' }, h('div', { class: 'thumb' }, img),
        h('div', { class: 'grow' }, h('strong', null, title), h('div', { class: 'muted small' }, hint), size ? h('div', { class: 'small' }, size.width + ' × ' + size.height) : null),
        h('div', { class: 'actions', style: { marginTop: '0' } }, up, input,
          size ? armed(t('remove'), function (b) { act(b, function () { return api('DELETE', 'images/' + key) }).then(renderApp) }) : null))
    }
    var pics = h('div', { class: 'panel' }, h('h2', null, t('images')),
      slot('icon', t('icon'), t('iconHint')), slot('logo', t('logo'), t('logoHint')), slot('square', t('square'), t('squareHint')))

    var L = S.links
    var counter = h('div', { class: 'panel' }, h('h2', null, t('counter')), h('p', { class: 'muted small' }, t('counterHint')),
      h('label', null, t('joinLink')), h('div', { class: 'secret' }, L.join),
      h('div', { class: 'actions' }, copyButton(L.join), h('a', { class: 'btn', href: L.poster, target: '_blank', rel: 'noopener' }, t('poster')),
        h('a', { class: 'btn secondary', href: L.qr, target: '_blank', rel: 'noopener' }, t('qr'))))
    return h('div', null, h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_card')))), look, pics, counter)
  }

  // ---------------------------------------------------------------------------------------------
  // Branches

  function branchesView() {
    var label = h('input')
    var where = h('input', { dir: 'ltr', placeholder: '31.9539, 35.8836' })
    var texts = pair(t('nearText'), '', t('nearTextAr'), '')
    var btn = h('button', { type: 'submit' }, t('addBranch'))
    var full = S.locations.length >= S.limits.locations
    var rows = S.locations.map(function (l) {
      var map = 'https://www.google.com/maps?q=' + l.latitude + ',' + l.longitude
      return h('tr', null, td(l.label), td(h('a', { href: map, target: '_blank', rel: 'noopener', dir: 'ltr' }, l.latitude.toFixed(4) + ', ' + l.longitude.toFixed(4))),
        td(h('span', { dir: 'auto', class: 'muted' }, (lang === 'ar' ? l.text_ar || l.text : l.text) || '')),
        td(armed(t('remove'), function (b) { act(b, function () { return api('DELETE', 'locations/' + l.id) }).then(renderApp) })))
    })
    return h('div', null, h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_branches')))),
      h('div', { class: 'panel' }, h('h2', null, t('branches')), h('p', { class: 'muted small' }, t('branchesHint', { n: S.limits.locations })),
        rows.length ? table([t('branchName'), t('where'), t('nearText'), ''], rows) : h('p', { class: 'empty' }, t('none')),
        full ? null : h('form', {
          onsubmit: function (e) {
            e.preventDefault()
            act(btn, function () { return api('POST', 'locations', { label: label.value, where: where.value, text: texts.en(), text_ar: texts.ar() }) }).then(function (r) { if (r) renderApp() })
          }
        }, h('div', { class: 'two' }, field(t('branchName'), label), field(t('where'), where, t('whereHint'))), texts, h('div', { class: 'actions' }, btn))))
  }

  // ---------------------------------------------------------------------------------------------
  // Staff

  var shownKey = null
  function staffView() {
    var label = h('input', { placeholder: 'Counter 1' })
    var btn = h('button', { type: 'submit' }, t('newKey'))
    var rows = S.staff.map(function (s) {
      return h('tr', null, td(s.label), td(fmtDate(s.created_at), true), td(s.last_used_at ? fmtDateTime(s.last_used_at) : t('never'), true),
        td(s.revoked_at ? h('span', { class: 'badge' }, t('revoked')) : armed(t('remove'), function (b) { act(b, function () { return api('DELETE', 'staff/' + s.id) }).then(renderApp) })))
    })
    var reveal = shownKey ? h('div', { class: 'panel' }, h('h2', null, shownKey.label), h('p', { class: 'warn' }, t('keyOnce')), h('div', { class: 'secret' }, shownKey.key),
      h('div', { class: 'actions' }, copyButton(shownKey.key), h('a', { class: 'btn secondary small', href: S.links.staff, target: '_blank', rel: 'noopener' }, t('staffPage')))) : null
    shownKey = null
    return h('div', null, h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_staff')))), reveal,
      h('div', { class: 'panel' }, h('h2', null, t('staff')), h('p', { class: 'muted small' }, t('staffHint')),
        h('p', null, h('a', { href: S.links.staff, target: '_blank', rel: 'noopener', dir: 'ltr' }, S.links.staff)),
        rows.length ? table([t('label'), t('created'), t('lastUsed'), ''], rows, [1, 2]) : null,
        h('form', {
          onsubmit: function (e) {
            e.preventDefault()
            var l = label.value || 'Counter'
            act(btn, function () { return api('POST', 'staff', { label: l }) }, null).then(function (r) { if (r) { shownKey = { label: l, key: r.key }; renderApp() } })
          }
        }, field(t('keyFor'), label), h('div', { class: 'actions' }, btn))))
  }

  // ---------------------------------------------------------------------------------------------
  // Settings

  function contactPanel() {
    var m = S.merchant
    var phone = h('input', { type: 'tel', dir: 'ltr', value: m.contact_phone || '' })
    var email = h('input', { type: 'email', dir: 'ltr', value: m.contact_email || '' })
    var address = h('input', { value: m.contact_address || '' })
    var btn = h('button', { type: 'submit' }, t('save'))
    return h('form', {
      class: 'panel', onsubmit: function (e) {
        e.preventDefault()
        act(btn, function () { return api('PUT', 'merchant', { contact_phone: phone.value, contact_email: email.value, contact_address: address.value }) })
      }
    }, h('h2', null, t('contact')), h('p', { class: 'muted small' }, t('contactHint')),
      h('div', { class: 'two' }, field(t('contactPhone'), phone), field(t('contactEmail'), email)), field(t('contactAddress'), address),
      h('div', { class: 'actions' }, btn, h('a', { class: 'btn secondary', href: S.links.privacy, target: '_blank', rel: 'noopener' }, t('privacyPage'))))
  }

  var shownAdmin = null
  function settingsView() {
    var zones = []
    try { zones = Intl.supportedValuesOf('timeZone') } catch (e) { zones = ['Asia/Amman', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London'] }
    if (zones.indexOf(S.merchant.timezone) < 0) zones.unshift(S.merchant.timezone)
    var zone = h('select', null, zones.map(function (z) { return h('option', { value: z }, z) }))
    zone.value = S.merchant.timezone
    var zbtn = h('button', { type: 'submit' }, t('save'))
    var email = h('input', { type: 'email', dir: 'ltr' })
    var name = h('input')
    var abtn = h('button', { type: 'submit' }, t('addAdmin'))
    var rows = S.admins.map(function (a) {
      var me = a.id === S.admin.id
      return h('tr', null, td(h('span', { dir: 'ltr' }, a.email)), td(a.name || ''), td(a.disabled_at ? t('revoked') : a.last_seen_at ? fmtDateTime(a.last_seen_at) : t('pending')),
        td(me ? h('span', { class: 'badge' }, t('you')) : a.disabled_at ? '' : armed(t('remove'), function (b) { act(b, function () { return api('DELETE', 'admins/' + a.id) }).then(renderApp) })))
    })
    var reveal = shownAdmin ? h('div', { class: 'panel' }, h('h2', { dir: 'ltr' }, shownAdmin.email), h('p', { class: 'warn' }, t('tempPassword')),
      h('div', { class: 'secret' }, shownAdmin.password), h('div', { class: 'actions' }, copyButton(shownAdmin.password))) : null
    shownAdmin = null
    return h('div', null, h('div', { class: 'head' }, h('div', { class: 'grow' }, h('h1', null, t('tabs_settings')))), reveal,
      h('div', { class: 'panel' }, h('h2', null, t('account')), h('p', { dir: 'ltr', class: 'muted' }, S.admin.email), h('h3', null, t('changePassword')), passwordForm()),
      contactPanel(),
      h('div', { class: 'panel' }, h('h2', null, t('admins')), h('p', { class: 'muted small' }, t('adminsHint')),
        table([t('email'), t('adminName'), t('lastUsed'), ''], rows),
        h('form', {
          onsubmit: function (e) {
            e.preventDefault()
            act(abtn, function () { return api('POST', 'admins', { email: email.value, name: name.value }) }, null).then(function (r) { if (r) { shownAdmin = r; renderApp() } })
          }
        }, h('div', { class: 'two' }, field(t('email'), email), field(t('adminName'), name, t('optional'))), h('div', { class: 'actions' }, abtn))),
      h('form', {
        class: 'panel', onsubmit: function (e) {
          e.preventDefault()
          act(zbtn, function () { return api('PUT', 'merchant', { timezone: zone.value }) })
        }
      }, h('h2', null, t('timezone')), h('p', { class: 'muted small' }, t('timezoneHint')), field(t('timezone'), zone), h('div', { class: 'actions' }, zbtn)))
  }

  var VIEWS = {
    overview: overview, members: membersView, messages: messagesView, earning: earningView,
    card: cardView, branches: branchesView, staff: staffView, settings: settingsView
  }

  function start() {
    return reload().then(render).catch(function (e) { if (token) renderLogin(e.message) })
  }

  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  document.title = t('title')
  if (token) start()
  else renderLogin()
})()
