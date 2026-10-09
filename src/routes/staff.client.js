// Staff scanner, runs in the browser. Camera frames go through jsQR; no app to install.
;(function () {
  var $ = function (id) { return document.getElementById(id) }
  var KEY = 'loyalty.staffKey'
  var key = null
  try { key = localStorage.getItem(KEY) } catch (e) {}
  var merchant = null
  var current = null
  var scanning = false
  var lastCode = ''

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

  function show(card, note, ok) {
    current = card
    $('result').hidden = false
    $('rName').textContent = card.name
    $('rBalance').textContent = card.program === 'stamps'
      ? Math.min(card.balance, card.threshold) + ' / ' + card.threshold + ' stamps'
      : card.balance + ' points'
    $('rReward').textContent = card.rewardsAvailable > 0
      ? 'Reward ready (' + card.rewardsAvailable + '): ' + card.rewardText
      : 'Reward at ' + card.threshold + ': ' + card.rewardText
    $('amountRow').hidden = card.program !== 'points'
    $('earn').textContent = card.program === 'stamps' ? 'Add a stamp' : 'Add points'
    $('redeem').hidden = card.rewardsAvailable < 1
    $('msg').textContent = note || ''
    $('msg').className = ok ? 'ok' : note ? 'err' : ''
  }

  function fail(e) {
    if (e.status === 401) return logout()
    $('result').hidden = false
    $('msg').textContent = e.message
    $('msg').className = 'err'
  }

  function lookup(code) {
    api('lookup', { code: code }).then(function (r) { show(r.card) }).catch(fail)
  }

  function busy(btn, p) {
    btn.disabled = true
    return p.finally(function () { btn.disabled = false })
  }

  $('earn').onclick = function () {
    if (!current) return
    var body = { serial: current.serial, requestId: requestId() }
    if (current.program === 'points') {
      var jod = parseFloat($('amount').value)
      if (!(jod > 0)) return fail(new Error('Enter the purchase amount'))
      body.amountFils = Math.round(jod * 1000)
    }
    busy($('earn'), api('earn', body).then(function (r) {
      $('amount').value = ''
      show(r.card, '+' + r.units + (r.card.program === 'stamps' ? ' stamp' : ' points') + ' added', true)
    }).catch(fail))
  }

  $('redeem').onclick = function () {
    if (!current || !confirm('Give the reward now: ' + current.rewardText + '?')) return
    busy($('redeem'), api('redeem', { serial: current.serial, requestId: requestId() }).then(function (r) {
      show(r.card, 'Reward given', true)
    }).catch(fail))
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
        className: 'muted', style: 'padding:16px', textContent: 'Camera not available. Type the card number below.',
      }))
    })
  }

  function start() {
    api('me').then(function (r) {
      merchant = r.merchant
      $('login').hidden = true
      $('app').hidden = false
      $('merchantName').textContent = merchant.name
      scan()
    }).catch(function (e) {
      $('loginErr').textContent = e.status === 401 ? 'That key is not recognised.' : e.message
      $('login').hidden = false
      $('app').hidden = true
    })
  }

  function logout() {
    try { localStorage.removeItem(KEY) } catch (e) {}
    location.reload()
  }

  $('logout').onclick = logout
  $('save').onclick = function () {
    key = $('key').value.trim()
    try { localStorage.setItem(KEY, key) } catch (e) {}
    start()
  }
  if (key) start()
})()
