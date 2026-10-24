import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
process.env.REACT_DIR = process.env.REACT_DIR || join(process.env.TEMP, "ga-react");
process.env.PREVIEW_LOCAL = "1";
process.env.PREVIEW_THEME = "dark";
const outDir = join(process.env.TEMP, "dsh-genshin-preview");
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const target = join(outDir, url.pathname.replace(/^\//, "") || "index.html");
  if (!existsSync(target)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": target.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
  res.end(readFileSync(target));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9811;
const child = spawn(EDGE, ["--headless=new","--disable-gpu","--hide-scrollbars",`--remote-debugging-port=${PORT}`,`--user-data-dir=${process.env.TEMP}\\dsh-p8`,"--window-size=1240,1300","about:blank"], { detached: true, stdio: "ignore" });
child.unref();
let targets = null;
for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 400)); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.some((t) => t.type === "page" && t.webSocketDebuggerUrl)) break; } catch {} }
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: origin + "/tab-characters.html" });
await new Promise((r) => setTimeout(r, 6500));
// 在 CV 模式与权重模式下各导一次图，比较 canvas 尺寸与文本
const run = async (mode) => {
  if (mode === "eff") { await evaluate(`(() => { [...document.querySelectorAll('.dga-segBtn')].find((b) => b.textContent.includes('权重')).click(); return 1; })()`); await new Promise((r) => setTimeout(r, 700)); }
  return evaluate(`new Promise((resolve) => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, type) {
      const c = document.querySelector('canvas');
      const info = { w: c.width, h: c.height, name: (document.querySelector('.dga-name') || {}).textContent };
      orig.call(this, function (blob) {
        resolve(JSON.stringify({ ...info, bytes: blob ? blob.size : 0, w2: this.width }));
      }, type);
    };
    [...document.querySelectorAll('.dga-btn')].find((b) => b.textContent.includes('生成图片')).click();
  })`);
};
console.log("CV:", await run("cv"));
console.log("权重:", await run("eff"));
ws.close(); server.close();
try { spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
