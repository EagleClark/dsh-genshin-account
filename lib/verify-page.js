/**
 * The standalone verification page.
 *
 * Why it exists: the geetest v3 widget has to load a remote script and run in a
 * fragment-capable window. Doing that inside the DSH GUI can be blocked by the
 * shell's content-security policy or by the plugin bundle's constraints — and
 * then the slider never appears, which looks like "the plugin is broken" rather
 * than "the widget could not load". Serving our own page from the plugin's own
 * host sidesteps both: same origin, no bundler, no shell policy.
 *
 * The page talks only to this plugin (`/verify/start`, `/verify/finish`), and it
 * keeps the purpose (`index` / `characters`) because miHoYo issues a token per
 * endpoint and reading a character needs its own.
 */

const PURPOSES = new Set(['index', 'characters'])

/** @returns {'index'|'characters'} anything unrecognised becomes 'index'. */
export function normalizePurpose(value) {
  const text = String(value == null ? '' : value)
  return PURPOSES.has(text) ? text : 'index'
}

/**
 * @param {'index'|'characters'} purpose
 * @returns a complete HTML document
 */
export function renderVerifyPage(purpose) {
  const start = normalizePurpose(purpose)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>米游社安全验证 · dsh-genshin-account</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; background:#0f1115; color:#e6e8ee; }
  main { width:min(520px,92vw); padding:28px; border:1px solid #2a2f3a; border-radius:14px; background:#161a21; }
  h1 { margin:0 0 6px; font-size:17px; }
  p  { margin:10px 0; color:#a9b1c1; }
  #box { margin:18px 0; min-height:240px; }
  .ok { color:#5ad19a; }
  .err { color:#ff8a8a; white-space:pre-wrap; }
  button { font:inherit; cursor:pointer; border-radius:8px; border:1px solid #3a4150; background:#1f2530;
           color:#e6e8ee; padding:7px 16px; }
  button.go { padding:10px 22px; border-color:#4a5568; background:#2a3140; }
  button.go:hover { background:#333c4e; }
  code { background:#1f2530; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<main>
  <h1>完成一次安全验证</h1>
  <p id="hint">米游社在返回战绩数据前要求一次人机验证。拖动下面的滑块即可，通过后此页面会自动读取账号。</p>
  <div id="box"></div>
  <p id="status">正在申请验证任务…</p>
  <p id="detail"></p>
</main>
<script>
(function () {
  var purpose = ${JSON.stringify(start)};
  var statusEl = document.getElementById('status');
  var detailEl = document.getElementById('detail');
  var box = document.getElementById('box');
  var hintEl = document.getElementById('hint');

  function say(text, kind) {
    statusEl.className = kind || '';
    statusEl.textContent = text;
  }

  /** Report one lifecycle step to the plugin, so a failure is diagnosable. */
  function report(event, detail) {
    try {
      fetch('/dsh-genshin-account/diag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instance: 'verify-page', event: event, detail: detail || {} }),
      });
    } catch (error) {
      /* reporting must never break the page */
    }
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) { return res.json(); });
  }

  function loadGt() {
    if (window.initGeetest) return Promise.resolve(window.initGeetest);
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://static.geetest.com/static/tools/gt.js';
      script.async = true;
      script.onload = function () { window.initGeetest ? resolve(window.initGeetest) : reject(new Error('gt.js 加载了但没有 initGeetest')); };
      script.onerror = function () { reject(new Error('无法加载 static.geetest.com 的验证脚本（网络或安全策略拦截）')); };
      document.head.appendChild(script);
    });
  }

  /**
   * Try one geetest product and report whether it actually painted anything.
   *
   * GeeTest v3 products behave very differently inside an iframe: float anchors a
   * floating panel (which can land outside the visible area - that is the empty
   * box that was reported), popup centres an overlay, bind draws inline into a
   * container. So: try them in order, keep a manual button that calls verify()
   * inside a real user gesture, and treat 'no geetest DOM node' as failure.
   */
  // bind first: it is the inline product the official page uses, and it is the
  // one that actually lives inside our container.
  var PRODUCTS = ['bind', 'popup', 'float'];
  // Which submission shape to try (the host tries one per drag, because a solved
  // validate is single-use). Order: original-first, the geetest ones later.
  // GeeTest v3 cannot be re-initialised in the same document, so switching the
  // submission shape means reloading the page. The attempt survives in
  // sessionStorage, keyed by purpose.
  var STATE_KEY = 'dgaVerifyShape';
  var shapeIndex = 0;
  var IS_HIGH = [true, true, false, false];
  var USE_SECCODE = [false, true, false, true];
  try {
    var savedShape = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    if (savedShape && savedShape.purpose === purpose && Number.isFinite(Number(savedShape.shape))) {
      shapeIndex = Number(savedShape.shape);
    }
  } catch (error) { shapeIndex = 0; }

  /**
   * Has anything painted? Deliberately generous: geetest's class names are not
   * part of its public API, and guessing them wrong once made this code wipe a
   * perfectly good slider (the user saw it flash). So: any child node, or any
   * element whose class mentions geetest.
   */
  function paintedCount() {
    var inBox = box.children ? box.children.length : 0;
    var anywhere = document.querySelectorAll('[class*="geetest"]').length;
    return inBox + anywhere;
  }

  function painted() {
    return paintedCount() > 0;
  }

  function tryProduct(initGeetest, task, product, done) {
    var settled = false;
    function finish(ok, why) {
      if (settled) return;
      settled = true;
      report('product', { product: product, ok: ok, why: why || '', nodes: paintedCount() });
      done(ok);
    }

    // Never clear the container here: a previous attempt may have painted
    // something the user can already use.
    try {
      initGeetest({
        gt: task.gt,
        challenge: task.challenge,
        new_captcha: task.newCaptcha === true,
        offline: false,
        product: product,
        width: '100%',
        lang: 'zh-cn',
      }, function (captcha) {
        report('captcha-object', { product: product });
        if (product === 'bind' && typeof captcha.appendTo === 'function') {
          try { captcha.appendTo(box); } catch (error) { report('append-throw', { message: String(error) }); }
        }
        captcha.onReady(function () {
          report('ready', { product: product, nodes: paintedCount() });
          var btn = document.createElement('button');
          btn.className = 'go';
          btn.textContent = '开始验证';
          btn.onclick = function () {
            btn.remove();
            try { captcha.verify(); } catch (error) { report('verify-throw', { message: String(error) }); }
          };
          detailEl.innerHTML = '';
          detailEl.appendChild(btn);
          // Give the widget time to paint before judging it.
          setTimeout(function () {
            if (painted()) {
              finish(true, 'painted');
              say('请拖动滑块完成验证');
              return;
            }
            if (product !== 'bind') {
              try { captcha.verify(); } catch (error) { /* ignore */ }
            }
            setTimeout(function () {
              if (painted()) {
                finish(true, 'painted-late');
                say('请拖动滑块完成验证');
              } else {
                finish(false, 'empty');
              }
            }, 2200);
          }, 600);
        });
        captcha.onSuccess(function () {
          var value = captcha.getValidate() || {};
          // Diagnostic: does geetest hand back the same challenge we asked with?
          // A mismatch is the most likely cause of retcode 10306.
          report('solved', {
            sameChallenge: String(value.geetest_challenge || '') === String(task.challenge || ''),
            geetestChallenge: String(value.geetest_challenge || '').slice(0, 8),
            originalChallenge: String(task.challenge || '').slice(0, 8),
            validateLength: String(value.geetest_validate || '').length,
            hasSeccode: Boolean(value.geetest_seccode),
          });
          say('验证通过，正在读取账号…');
          finish(true, 'solved');
          finishDone(
            value.geetest_challenge || '',
            value.geetest_validate || '',
            value.geetest_seccode || '',
            task.challenge || ''
          );
        });
        captcha.onError(function () {
          report('widget-error', { product: product });
          finish(false, 'onError');
        });
        captcha.onClose(function () {
          say('验证窗口已关闭，可以点重试', 'err');
        });
      });
    } catch (error) {
      report('init-throw', { product: product, message: String((error && error.message) || error) });
      finish(false, 'init-threw');
      return;
    }

    // Last resort: if nothing is on screen after 5s, move on (without wiping).
    setTimeout(function () { finish(painted(), 'timeout-5s'); }, 5000);
  }

  function tryProducts(initGeetest, task) {
    var index = 0;
    function next() {
      if (painted()) return; // an earlier product already worked
      if (index >= PRODUCTS.length) {
        say('三种验证控件都没有渲染出来。请把这个页面的地址告诉我，我再换实现。', 'err');
        report('all-products-failed', { purpose: purpose });
        return;
      }
      var product = PRODUCTS[index++];
      say('正在加载验证控件（' + product + '）…');
      tryProduct(initGeetest, task, product, function (ok) {
        if (!ok) next();
      });
    }
    next();
  }
  function startFor(which) {
    purpose = which;
    hintEl.textContent = which === 'characters'
      ? '账号概览已通过。角色详情需要单独验证一次，请再拖一次滑块。'
      : '米游社在返回战绩数据前要求一次人机验证。看到滑块后拖动它，通过后此页面会自动读取账号。';
    say('正在申请验证任务…');
    report('start', { purpose: which, embedded: window.parent !== window, secure: location.protocol });
    box.innerHTML = '';
    detailEl.innerHTML = '';
    return post('/dsh-genshin-account/verify/start', { purpose: which, isHigh: IS_HIGH[shapeIndex] !== false })
      .then(function (task) {
        if (!task || task.ok === false) throw new Error((task && task.error) || '申请验证任务失败');
        report('task', { purpose: which, ok: true, gt: String(task.gt || '').slice(0, 8) });
        say('正在加载验证组件…');
        return loadGt().then(function (initGeetest) {
          report('script', { ok: true });
          tryProducts(initGeetest, task);
        });
      })
      .catch(function (error) {
        report('error', { message: String((error && error.message) || error).slice(0, 120) });
        say(String(error && error.message ? error.message : error), 'err');
      });
  }

  function finishDone(challenge, validate, seccode, originalChallenge) {
    return post('/dsh-genshin-account/verify/finish', {
      purpose: purpose,
      challenge: challenge,
      validate: validate,
      seccode: seccode,
      originalChallenge: originalChallenge,
      shapeIndex: shapeIndex,
      useSeccode: USE_SECCODE[shapeIndex] === true,
    })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error) || '读取失败');
        if (data.needNext) {
          say('账号概览已通过，还需要为角色详情再验证一次');
          try { sessionStorage.setItem(STATE_KEY, JSON.stringify({ shape: 0, purpose: data.needNext })); } catch (error) { /* ignore */ }
          setTimeout(function () {
            location.href = '/dsh-genshin-account/verify/widget?purpose=' + encodeURIComponent(data.needNext);
          }, 1200);
          return null;
        }
        try { sessionStorage.removeItem(STATE_KEY); } catch (error) { /* ignore */ }
        var count = (data.characters || []).length;
        report('done', { purpose: purpose, characters: count });
        say('完成：已读取 ' + count + ' 个角色', 'ok');
        detailEl.textContent = '可以关闭此页面，回到「原神账号」查看数据。';
        box.innerHTML = '';
        try {
          var host = window.parent && window.parent !== window ? window.parent : window.opener;
          if (host) host.postMessage({ type: 'dga-verify-done', characters: count }, location.origin);
        } catch (error) { /* host may be gone */ }
      })
      .catch(function (error) {
        var message = String((error && error.message) || error);
        say(message, 'err');
        // Retry with the next shape automatically: the previous answer was
        // rejected, so the user only has to drag again.
        var total = 4;
        if (shapeIndex + 1 < total) {
          try { sessionStorage.setItem(STATE_KEY, JSON.stringify({ shape: shapeIndex + 1, purpose: purpose })); } catch (error) { /* ignore */ }
          hintEl.textContent = '上一种提交方式被米游社拒绝了。页面会自动重载并换下一种，请再拖一次滑块。';
          detailEl.textContent = '1.5 秒后自动重载…';
          setTimeout(function () { location.reload(); }, 1500);
        } else {
          try { sessionStorage.removeItem(STATE_KEY); } catch (error) { /* ignore */ }
          detailEl.innerHTML = '四种提交方式都被拒绝了。把这句话告诉我，我不再让你试。';
        }
      });
  }

  if (shapeIndex > 0) {
    hintEl.textContent = '正在试第 ' + (shapeIndex + 1) + ' 种提交方式，请再拖一次滑块。';
    report('retry-shape', { shape: shapeIndex, purpose: purpose });
  }
  startFor(purpose);
})();
</script>
</body>
</html>`
}
