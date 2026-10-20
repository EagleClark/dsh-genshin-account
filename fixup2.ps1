$path = "client\client.js"
$text = Get-Content $path -Raw -Encoding UTF8
$pairs = @(
  @('if (data && data.error) showMessage(data.error);', 'if (data && data.error) showMessage(data.error, true);'),
  @('showMessage("配置暂不可写：当前页面不是从本机打开的，或插件配置未就绪。");', 'showMessage(notWritableMessage(), true);'),
  @('showMessage((data && data.error) || "同步失败");', 'showMessage((data && data.error) || "同步失败", true);')
)
foreach ($p in $pairs) {
  $before = ([regex]::Matches($text, [regex]::Escape($p[0]))).Count
  $text = $text.Replace($p[0], $p[1])
  "$before x  $($p[0])"
}
$text = $text.Replace('showMessage(String(failure && failure.message ? failure.message : failure));', 'showMessage(String(failure && failure.message ? failure.message : failure), true);')
$text = $text.Replace('showMessage("保存/同步失败：" + String(failure && failure.message ? failure.message : failure));', 'showMessage("保存/同步失败：" + String(failure && failure.message ? failure.message : failure), true);')
$text = $text.Replace('showMessage("保存失败：" + String(failure && failure.message ? failure.message : failure));', 'showMessage("保存失败：" + String(failure && failure.message ? failure.message : failure), true);')
Set-Content -Path $path -Value $text -Encoding UTF8 -NoNewline
"done"
