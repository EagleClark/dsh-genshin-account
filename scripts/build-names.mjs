import fs from "node:fs";
const url = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/loc.json";
const loc = await (await fetch(url)).json();
const chs = loc["zh-cn"] || {};
// Keep hash keys (numeric strings) and FIGHT_PROP_* keys; drop UI/promo keys.
const out = {};
let n = 0;
for (const [k, v] of Object.entries(chs)) {
  if (typeof v !== "string" || !v) continue;
  if (/^\d+$/.test(k) || k.startsWith("FIGHT_PROP_")) { out[k] = v; n++; }
}
const bytes = JSON.stringify(out);
fs.writeFileSync("data/names-zh.json", bytes);
console.log("entries", n, "bytes", bytes.length, "=", (bytes.length/1024).toFixed(1)+"KB");
console.log("sample", JSON.stringify(Object.entries(out).slice(0,3)));
console.log("crit:", out["FIGHT_PROP_CRITICAL"], "| hutao:", out["1940919994"]);

