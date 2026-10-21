/**
 * Verification lab: one page that reports, step by step, what actually works in
 * the browser. Served by scripts/verify-standalone.mjs at /lab.
 *
 * The question it answers: is the widget unable to render because (a) the geetest
 * SDK cannot run on our page at all, (b) the v3 online handshake is rejected for
 * mihoyo's gt, or (c) mihoyo has moved to geetest v4?
 *
 * Everything is reported to the plugin's /diag, so the answer can be read from
 * /state without asking for screenshots.
 */
export function renderLabPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>验证组件诊断</title>
<style>
  body { margin:0; padding:20px; font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#0f1115; color:#e6e8ee; }
  h1 { font-size:17px; margin:0 0 10px; }
  li { margin:2px 0; color:#a9b1c1; }
  li.ok { color:#5ad19a; }
  li.bad { color:#ff8a8a; }
  #box { min-height:180px; margin-top:14px; }
</style>
</head>
<body>
<h1>验证组件诊断</h1>
<p style="color:#a9b1c1">这个页面会自动跑几项检测，结果同时上报给插件。稍等几秒，然后回到对话里说一声即可。</p>
<ol id="log"></ol>
<div id="box"></div>
<script>
(function () {
  var logEl = document.getElementById('log');
  var box = document.getElementById('box');

  function report(event, detail) {
    try {
      fetch('/dsh-genshin-account/diag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instance: 'verify-lab', event: event, detail: detail || {} }),
      });
    } catch (error) { /* ignore */ }
  }

  function line(text, ok) {
    var li = document.createElement('li');
    li.textContent = text;
    if (ok === true) li.className = 'ok';
    if (ok === false) li.className = 'bad';
    logEl.appendChild(li);
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(true); };
      script.onerror = function () { resolve(false); };
      document.head.appendChild(script);
      setTimeout(function () { resolve(false); }, 8000);
    });
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) { return res.json(); });
  }

  function hasNode() {
    return Boolean(document.querySelector('.geetest_holder, .geetest_panel, .geetest_popup_wrap, .geetest_bind, .geetest_window, .geetest_box'));
  }

  report('lab-ua', { ua: navigator.userAgent, protocol: location.protocol, host: location.host, embedded: window.parent !== window });
  line('UA: ' + navigator.userAgent.slice(0, 60));

  // 1. Which SDKs load at all?
  var v3Loaded = false;
  var v4Loaded = false;

  loadScript('https://static.geetest.com/static/tools/gt.js').then(function (ok) {
    v3Loaded = ok && Boolean(window.initGeetest);
    report('lab-v3-sdk', { loaded: v3Loaded });
    line('geetest v3 SDK（gt.js）: ' + (v3Loaded ? '加载成功' : '加载失败'), v3Loaded);
    return step2();
  });

  function step2() {
    if (!v3Loaded) return step4();
    // 2. Can the widget render offline? That isolates "SDK works" from
    //    "mihoyo's gt is rejected by geetest's server".
    return post('/dsh-genshin-account/verify/start', { purpose: 'index' }).then(function (task) {
      if (!task || task.ok === false) {
        report('lab-task-failed', { error: String(task && task.error) });
        line('申请验证任务失败：' + String(task && task.error), false);
        return step4();
      }
      window.__lastGt = String(task.gt || '');
      report('lab-task', { gt: window.__lastGt.slice(0, 8) });
      line('拿到 gt / challenge', true);
      return renderOffline(task).then(function () { return renderOnline(task); }).then(function () { return step4(); });
    });
  }

  function renderOffline(task) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(ok, why) {
        if (done) return;
        done = true;
        report('lab-v3-offline', { ok: ok, why: why || '', dom: hasNode() });
        line('v3 离线模式渲染: ' + (ok ? '成功' : '失败（' + why + '）'), ok);
        resolve();
      }
      try {
        box.innerHTML = '';
        window.initGeetest({
          gt: task.gt,
          challenge: task.challenge,
          offline: true,
          new_captcha: false,
          product: 'bind',
          width: '100%',
          lang: 'zh-cn',
        }, function (captcha) {
          if (typeof captcha.appendTo === 'function') {
            try { captcha.appendTo(box); } catch (error) { report('lab-append-throw', { message: String(error) }); }
          }
          captcha.onReady(function () {
            setTimeout(function () { finish(hasNode(), 'no-dom'); }, 1200);
          });
          captcha.onError(function () { finish(false, 'onError'); });
        });
      } catch (error) {
        finish(false, 'throw');
      }
      setTimeout(function () { finish(hasNode(), 'timeout'); }, 6000);
    });
  }

  function renderOnline(task) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(ok, why) {
        if (done) return;
        done = true;
        report('lab-v3-online', { ok: ok, why: why || '', dom: hasNode() });
        line('v3 在线模式（用米游社的 gt）: ' + (ok ? '成功' : '失败（' + why + '）'), ok);
        resolve();
      }
      try {
        box.innerHTML = '';
        window.initGeetest({
          gt: task.gt,
          challenge: task.challenge,
          offline: false,
          new_captcha: task.newCaptcha === true,
          product: 'popup',
          width: '100%',
          lang: 'zh-cn',
        }, function (captcha) {
          captcha.onReady(function () {
            try { captcha.verify(); } catch (error) { /* ignore */ }
            setTimeout(function () { finish(hasNode(), 'no-dom'); }, 1500);
          });
          captcha.onError(function () { finish(false, 'onError'); });
        });
      } catch (error) {
        finish(false, 'throw');
      }
      setTimeout(function () { finish(hasNode(), 'timeout'); }, 6000);
    });
  }

  function step4() {
    // 3. Do we have the v4 SDK? If mihoyo has migrated, v4 is the way in.
    return loadScript('https://static.geetest.com/v4/gt4.js').then(function (ok) {
      v4Loaded = ok && typeof window.initGeetest4 === 'function';
      report('lab-v4-sdk', { loaded: v4Loaded });
      line('geetest v4 SDK（gt4.js）: ' + (v4Loaded ? '加载成功' : '加载失败'), v4Loaded);
      if (!v4Loaded) return null;
      return new Promise(function (resolve) {
        var done = false;
        function finish(ok, why) {
          if (done) return;
          done = true;
          report('lab-v4-online', { ok: ok, why: why || '', dom: hasNode() });
          line('v4 在线模式（把 gt 当 captchaId）: ' + (ok ? '成功' : '失败（' + why + '）'), ok);
          resolve();
        }
        try {
          box.innerHTML = '';
          window.initGeetest4({
            captchaId: (window.__lastGt || ''),
            product: 'bind',
            language: 'zho',
          }, function (captcha) {
            if (!captcha) { finish(false, 'null-captcha'); return; }
            captcha.onReady(function () {
              try { captcha.showBox(); } catch (error) { /* ignore */ }
              setTimeout(function () { finish(hasNode(), 'no-dom'); }, 1500);
            });
            captcha.onError && captcha.onError(function () { finish(false, 'onError'); });
          });
        } catch (error) {
          finish(false, 'throw');
        }
        setTimeout(function () { finish(hasNode(), 'timeout'); }, 6000);
      });
    }).then(function () {
      report('lab-done', { v3: v3Loaded, v4: v4Loaded });
      line('诊断结束，可以关掉这个页面了。');
    });
  }
})();
</script>
</body>
</html>`
}
