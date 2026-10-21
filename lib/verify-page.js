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
  var PRODUCTS = ['popup', 'bind', 'float'];

  function hasGeetestNode() {
    return Boolean(document.querySelector('.geetest_holder, .geetest_panel, .geetest_popup_wrap, .geetest_bind, .geetest_window'));
  }

  function tryProduct(initGeetest, task, product, done) {
    var settled = false;
    function finish(ok, why) {
      if (settled) return;
      settled = true;
      report('product', { product: product, ok: ok, why: why || '' });
      done(ok);
    }

    box.innerHTML = '';
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
        // GeeTest v3: the bind product does NOT paint by itself - it has to be
        // appended into a container. Without this the box stays empty forever,
        // which is exactly the reported symptom.
        if (product === 'bind' && typeof captcha.appendTo === 'function') {
          try { captcha.appendTo(box); } catch (error) { report('append-throw', { message: String(error) }); }
        }
        captcha.onReady(function () {
          report('ready', { product: product });
          var btn = document.createElement('button');
          btn.className = 'go';
          btn.textContent = '开始验证';
          btn.onclick = function () {
            btn.remove();
            try { captcha.verify(); } catch (error) { report('verify-throw', { message: String(error) }); }
          };
          detailEl.innerHTML = '';
          detailEl.appendChild(btn);
          setTimeout(function () {
            if (hasGeetestNode()) {
              finish(true, 'painted');
              say('请拖动滑块完成验证');
              return;
            }
            // bind already appended; the other products only paint on verify().
            if (product !== 'bind') {
              try { captcha.verify(); } catch (error) { /* ignore */ }
            }
            setTimeout(function () {
              if (hasGeetestNode()) {
                finish(true, 'painted-after-verify');
                say('请拖动滑块完成验证');
              } else {
                finish(false, 'no-dom');
              }
            }, 1200);
          }, 400);
        });
        captcha.onSuccess(function () {
          var value = captcha.getValidate() || {};
          say('验证通过，正在读取账号…');
          finish(true, 'solved');
          finishDone(value.geetest_challenge || '', value.geetest_validate || '');
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

    setTimeout(function () { finish(hasGeetestNode(), 'timeout-1.5s'); }, 1500);
  }

  function tryProducts(initGeetest, task) {
    var index = 0;
    function next() {
      if (index >= PRODUCTS.length) {
        say('三种验证控件都没有渲染出来。请回到插件页点「在新窗口验证」，或把这条消息告诉我。', 'err');
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
    return post('/dsh-genshin-account/verify/start', { purpose: which })
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

  function finishDone(challenge, validate) {
    return post('/dsh-genshin-account/verify/finish', { purpose: purpose, challenge: challenge, validate: validate })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error) || '读取失败');
        if (data.needNext) {
          say('账号概览已通过，还需要为角色详情再验证一次');
          return startFor(data.needNext);
        }
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
        say(String((error && error.message) || error), 'err');
        detailEl.innerHTML = '如果反复失败，回到插件页面点「在新窗口验证」。';
      });
  }

  startFor(purpose);
})();
</script>
</body>
</html>`
}
