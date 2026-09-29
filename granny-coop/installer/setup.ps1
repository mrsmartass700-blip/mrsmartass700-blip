# Бабка Setup Wizard — загрузчик. Проверяет Node.js (или качает портативный) и открывает мастер установки.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'Бабка Setup Wizard — загрузчик'
$here = $PSScriptRoot
$root = Split-Path -Parent $here
$runtime = Join-Path $root 'runtime'
$bundled = Join-Path $runtime 'node.exe'

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

Clear-Host
Say ''
Say '   ____        _     _         ____       _               ' Red
Say '  | __ )  __ _| |__ | | ____ _/ ___|  ___| |_ _   _ _ __  ' Red
Say '  |  _ \ / _` | ''_ \| |/ / _` \___ \ / _ \ __| | | | ''_ \ ' Red
Say '  | |_) | (_| | |_) |   < (_| |___) |  __/ |_| |_| | |_) |' Red
Say '  |____/ \__,_|_.__/|_|\_\__,_|____/ \___|\__|\__,_| .__/ ' Red
Say '                                                   |_|    ' Red
Say '  Загрузчик мастера установки. Бабка уже надевает тапки...' DarkGray
Say ''

$node = $null
if (Test-Path $bundled) { $node = $bundled; Say "  [ok] Встроенный Node.js найден" Green }
else {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $v = (& $cmd.Source -v).Trim()
      if ([int]($v.TrimStart('v').Split('.')[0]) -ge 18) { $node = $cmd.Source; Say "  [ok] Node.js $v найден в системе" Green }
      else { Say "  [!] Node.js $v слишком старый (нужен 18+). Скачаем свежий." Yellow }
    } catch { }
  }
}

if (-not $node) {
  Say '  [..] Бабке нужен Node.js, чтобы бегать. Качаю портативную версию (~30 МБ, в систему НЕ ставится)...' Yellow
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    $ver = 'v22.20.0'
    try {
      $idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 20
      $lts = $idx | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
      if ($lts) { $ver = $lts.version }
    } catch { Say '       (не удалось узнать последнюю версию, беру проверенную)' DarkGray }
    $arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' } elseif (-not [Environment]::Is64BitOperatingSystem) { $arch = 'x86' }
    $name = "node-$ver-win-$arch"
    $url = "https://nodejs.org/dist/$ver/$name.zip"
    $zip = Join-Path $env:TEMP "babka-$name.zip"
    $tmp = Join-Path $env:TEMP "babka-$name"
    Say "       $url" DarkGray
    Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    Copy-Item (Join-Path $tmp "$name\node.exe") $bundled -Force
    Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
    $node = $bundled
    Say "  [ok] Node.js $ver скачан" Green
  } catch {
    Say ''
    Say "  [X] Не получилось скачать Node.js: $($_.Exception.Message)" Red
    Say '      Поставьте Node.js LTS вручную: https://nodejs.org (кнопка LTS), потом снова запустите SETUP.bat' Red
    Start-Process 'https://nodejs.org/'
    Read-Host '  Нажмите Enter'
    exit 1
  }
}

Say ''
Say '  Открываю мастер установки... (это окно не закрывайте до конца установки)' Cyan
& $node (Join-Path $here 'installer.js')
exit $LASTEXITCODE
