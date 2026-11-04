// Staff scanner, runs in the browser. Camera frames go through jsQR; no app to install.
// Arabic or English (the phone's language, switchable); the last choice is remembered on the device.
;(function () {
  var $ = function (id) { return document.getElementById(id) }
  var KEY = 'loyalty.staffKey'
  var LANG = 'loyalty.staffLang'
  function load(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) {} }
  var key = load(KEY)
  var lang = load(LANG) || (/^ar\b/i.test(navigator.language || '') ? 'ar' : 'en')
  var merchant = null
  var cats = []
  var cat = null
  var current = null
  var canUndo = false
  var scanning = false
  var lastCode = ''

  var T = {
    en: {
      staff: 'Staff', pasteKey: 'Paste the staff key you were given. This phone remembers it.', staffKey: 'Staff key', continue: 'Continue',
      scan: 'Scan a card', typeNumber: 'Or type the card number', find: 'Find card', whatBought: 'What was bought',
      amount: 'Purchase amount (JOD)', amountOptional: 'Purchase amount (JOD, optional)', addStamp: 'Add a stamp', addPoints: 'Add points',
      giveReward: 'Give a reward', tapAgain: 'Tap again to give: ', undo: 'Undo my last entry', signOut: 'Sign out of this phone',
      stamps: 'stamps', points: 'points', ready: 'Reward ready ({n}): {r}', rewardAt: 'Reward at {t}: {r}',
      added: '+{n} {u} added', recorded: 'Purchase recorded', given: 'Reward given: {r}', undone: 'Taken back: {what}', stamp: 'stamp', theReward: 'the reward',
      boostNow: '×{x} now: {l}', noCamera: 'Camera not available. Type the card number below.', badKey: 'That key is not recognised.',
      lang: 'العربية',
      errors: {
        'Pick what was bought': 'Pick what was bought', 'Enter the purchase amount': 'Enter the purchase amount',
      },
    },
    ar: {
      staff: 'الموظفون', pasteKey: 'الصق مفتاح الموظف الذي استلمته. سيتذكره هذا الهاتف.', staffKey: 'مفتاح الموظف', continue: 'متابعة',
      scan: 'امسح بطاقة', typeNumber: 'أو اكتب رقم البطاقة', find: 'ابحث عن البطاقة', whatBought: 'ما الذي تم شراؤه',
      amount: 'قيمة الشراء (د.أ)', amountOptional: 'قيمة الشراء (د.أ، اختياري)', addStamp: 'أضف طابعًا', addPoints: 'أضف النقاط',
      giveReward: 'امنح مكافأة', tapAgain: 'اضغط مرة أخرى لمنح: ', undo: 'تراجع عن آخر إدخال لي', signOut: 'تسجيل الخروج من هذا الهاتف',
      stamps: 'طوابع', points: 'نقطة', ready: 'المكافأة جاهزة ({n}): {r}', rewardAt: 'المكافأة عند {t}: {r}',
      added: 'أُضيف {n} {u}', recorded: 'سُجّلت عملية الشراء', given: 'مُنحت المكافأة: {r}', undone: 'تم التراجع عن: {what}', stamp: 'طابع', theReward: 'المكافأة',
      boostNow: '×{x} الآن: {l}', noCamera: 'الكاميرا غير متاحة. اكتب رقم البطاقة في الأسفل.', badKey: 'هذا المفتاح غير معروف.',
      lang: 'English',
      errors: {
        'Pick what was bought': 'اختر ما تم شراؤه', 'Enter the purchase amount': 'أدخل قيمة الشراء', 'Check the purchase amount': 'تحقق من قيمة الشراء',
        'That is not one of our cards': 'هذه ليست إحدى بطاقاتنا', 'Card not found': 'لم يُعثر على البطاقة', 'Not enough yet': 'الرصيد لا يكفي بعد',
        'Nothing to undo': 'لا يوجد ما يمكن التراجع عنه: آخر إدخال لك على هذه البطاقة خلال 10 دقائق فقط',
        'That reward is no longer offered': 'هذه المكافأة لم تعد متاحة', 'That category is no longer used': 'هذه الفئة لم تعد مستخدمة',
        'Staff key not recognised': 'مفتاح الموظف غير معروف',
      },
    },
  }
  function t(k, vars) {
    var s = T[lang][k] != null ? T[lang][k] : T.en[k]
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])) })
    return s
  }
  /** Server messages are English; the common ones read in Arabic too. */
  function tErr(message) {
    var m = String(message || '')
    var table = T[lang].errors
    for (var k in table) if (m.indexOf(k) === 0) return table[k]
    return m
  }

  function apply() {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t(el.getAttribute('data-t')) })
    $('lang').textContent = t('lang')
    if (current) show(current)
  }

  function api(path, body) {
    return fetch('/api/staff/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status })
        return j
      })
    })
  }

  function requestId() {
    return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random()
  }
  function name(x, en, ar) { return lang === 'ar' && x[ar] ? x[ar] : x[en] }

  // What was bought: one tap. A single category is picked for staff; with several, every purchase
  // needs one, chosen again each time so the last customer's category never carries over.
  function renderCats() {
    var box = $('cats')
    box.textContent = ''
    $('catRow').hidden = cats.length === 0
    if (cats.length === 1) cat = cats[0]
    cats.forEach(function (c) {
      var b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      b.textContent = name(c, 'name', 'name_ar')
      b.setAttribute('aria-pressed', cat && cat.id === c.id ? 'true' : 'false')
      b.onclick = function () { cat = c; renderCats(); amountRow() }
      box.appendChild(b)
    })
  }

  function amountNeeded() {
    if (!current || current.program !== 'points') return false
    return cats.length === 0 || !cat || cat.needsAmount
  }

  function amountRow() {
    if (!current) return
    $('amountRow').hidden = current.program !== 'points'
    $('amountLabel').textContent = amountNeeded() ? t('amount') : t('amountOptional')
  }

  /** Rewards the card can have now. Giving one takes two taps, never a browser dialog. */
  function renderRewards(card) {
    var box = $('rewards')
    box.textContent = ''
    var affordable = (card.menu || []).filter(function (r) { return r.affordable })
    $('rewardsRow').hidden = affordable.length === 0
    affordable.forEach(function (r) {
      var label = name(r, 'name', 'name_ar') + ' (' + r.cost + ')'
      var b = document.createElement('button')
      b.type = 'button'
      b.className = 'btn secondary'
      b.textContent = label
      var timer = null
      b.onclick = function () {
        if (!b.classList.contains('armed')) {
          b.classList.add('armed')
          b.textContent = t('tapAgain') + name(r, 'name', 'name_ar')
          timer = setTimeout(function () { b.classList.remove('armed'); b.textContent = label }, 4000)
          return
        }
        clearTimeout(timer)
        busy(b, api('redeem', { serial: card.serial, rewardId: r.id, requestId: requestId() }).then(function (res) {
          canUndo = true
          show(res.card, t('given', { r: name(r, 'name', 'name_ar') }), true)
        }).catch(fail))
      }
      box.appendChild(b)
    })
  }

  function renderBoosts(card) {
    var list = card.boosts || []
    $('boost').hidden = list.length === 0
    $('boost').textContent = list.map(function (b) {
      var c = b.category_id ? cats.filter(function (x) { return x.id === b.category_id })[0] : null
      return t('boostNow', { x: b.multiplier, l: name(b, 'label', 'label_ar') + (c ? ' (' + name(c, 'name', 'name_ar') + ')' : '') })
    }).join(' · ')
  }

  function show(card, note, ok) {
    current = card
    $('result').hidden = false
    $('rName').textContent = card.name
    var reward = lang === 'ar' && card.rewardTextAr ? card.rewardTextAr : card.rewardText
    $('rBalance').textContent = card.program === 'stamps'
      ? Math.min(card.balance, card.threshold) + ' / ' + card.threshold + ' ' + t('stamps')
      : card.balance + ' ' + t('points')
    $('rReward').textContent = card.rewardsAvailable > 0 ? t('ready', { n: card.rewardsAvailable, r: reward }) : t('rewardAt', { t: card.threshold, r: reward })
    amountRow()
    $('earn').textContent = card.program === 'stamps' ? t('addStamp') : t('addPoints')
    renderRewards(card)
    renderBoosts(card)
    $('undo').hidden = !canUndo
    if (note !== undefined) {
      $('msg').textContent = note || ''
      $('msg').className = ok ? 'ok' : note ? 'err' : ''
    }
  }

  function fail(e) {
    if (e.status === 401) return logout()
    $('result').hidden = false
    $('msg').textContent = tErr(e.message)
    $('msg').className = 'err'
  }

  function lookup(code) {
    api('lookup', { code: code }).then(function (r) {
      if (cats.length > 1) cat = null
      if (!current || current.serial !== r.card.serial) canUndo = false
      renderCats()
      show(r.card, '')
    }).catch(fail)
  }

  function busy(btn, p) {
    btn.disabled = true
    return p.finally(function () { btn.disabled = false })
  }

  $('earn').onclick = function () {
    if (!current) return
    if (cats.length > 0 && !cat) return fail(new Error('Pick what was bought'))
    var body = { serial: current.serial, requestId: requestId() }
    if (cat) body.categoryId = cat.id
    if (current.program === 'points') {
      var raw = $('amount').value.trim()
      var jod = parseFloat(raw)
      if (amountNeeded() && !(jod > 0)) return fail(new Error('Enter the purchase amount'))
      if (raw && !(jod > 0)) return fail(new Error('Check the purchase amount'))
      if (jod > 0) body.amountFils = Math.round(jod * 1000)
    }
    busy($('earn'), api('earn', body).then(function (r) {
      $('amount').value = ''
      if (cats.length > 1) cat = null
      canUndo = true
      renderCats()
      var unit = r.card.program === 'stamps' ? (r.units === 1 ? t('stamp') : t('stamps')) : t('points')
      show(r.card, r.units === 0 ? t('recorded') : t('added', { n: r.units, u: unit }), true)
    }).catch(fail))
  }

  $('undo').onclick = function () {
    if (!current) return
    busy($('undo'), api('undo', { serial: current.serial, requestId: requestId() }).then(function (r) {
      canUndo = false
      var u = r.undone
      var unit = r.card.program === 'stamps' ? (u.units === 1 ? t('stamp') : t('stamps')) : t('points')
      var what = u.kind === 'earn' ? '+' + u.units + ' ' + unit : t('theReward')
      show(r.card, t('undone', { what: what }), true)
    }).catch(function (e) { canUndo = false; $('undo').hidden = true; fail(e) }))
  }

  $('lookup').onclick = function () { lookup($('manual').value) }

  function scan() {
    var video = $('video')
    var canvas = document.createElement('canvas')
    var ctx = canvas.getContext('2d', { willReadFrequently: true })
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      video.srcObject = stream
      video.play()
      scanning = true
      ;(function tick() {
        if (!scanning) return
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0)
          var img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          var hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (hit && hit.data !== lastCode) {
            lastCode = hit.data
            setTimeout(function () { lastCode = '' }, 4000)
            if (navigator.vibrate) navigator.vibrate(60)
            lookup(hit.data)
          }
        }
        requestAnimationFrame(tick)
      })()
    }).catch(function () {
      $('video').replaceWith(Object.assign(document.createElement('p'), {
        className: 'muted', style: 'padding:16px', textContent: t('noCamera'),
      }))
    })
  }

  function start() {
    api('me').then(function (r) {
      merchant = r.merchant
      cats = r.categories || []
      renderCats()
      $('login').hidden = true
      $('app').hidden = false
      $('merchantName').textContent = merchant.name
      scan()
    }).catch(function (e) {
      $('loginErr').textContent = e.status === 401 ? t('badKey') : tErr(e.message)
      $('login').hidden = false
      $('app').hidden = true
    })
  }

  function logout() {
    save(KEY, null)
    location.reload()
  }

  $('lang').onclick = function () {
    lang = lang === 'ar' ? 'en' : 'ar'
    save(LANG, lang)
    renderCats()
    apply()
  }
  $('logout').onclick = logout
  $('save').onclick = function () {
    key = $('key').value.trim()
    save(KEY, key)
    start()
  }
  apply()
  if (key) start()
})()
