# «Бабка: Кооп» — удаление игры. Запускается из «Параметры → Приложения», ярлыка в «Пуске» или UNINSTALL.bat.
$ErrorActionPreference = 'Continue'
$dir = $PSScriptRoot
$port = '__PORT__'
$app = 'Бабка Кооп'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$title = 'Удаление «Бабка: Кооп»'

$q = [System.Windows.Forms.MessageBox]::Show(
  "Удалить игру «Бабка: Кооп» и все её компоненты?`n`nПапка: $dir",
  $title, 'YesNo', 'Question', 'Button2')
if ($q -ne 'Yes') { exit 0 }

# 1. закрываем игру и её окна (иначе файлы заняты)
Get-Process -Name 'BabkaCoop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
try {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe' OR Name='browser.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -like '*BabkaCoop\browser-*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }
Start-Sleep -Milliseconds 700

# 2. ярлыки
$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$app.lnk"
if (Test-Path -LiteralPath $desk) { Remove-Item -LiteralPath $desk -Force }
$sm = Join-Path ([Environment]::GetFolderPath('Programs')) $app
if (Test-Path -LiteralPath $sm) { Remove-Item -LiteralPath $sm -Recurse -Force }

# 3. запись в «Приложениях»
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BabkaCoop' -Recurse -Force -ErrorAction SilentlyContinue

# 4. правило брандмауэра (нужны права администратора)
$rule = "Babka Coop (TCP $port)"
$fwNote = ''
if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
  try {
    Start-Process -FilePath 'netsh.exe' -ArgumentList "advfirewall firewall delete rule name=`"$rule`"" -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction Stop
  } catch { $fwNote = "`n`nПравило брандмауэра «$rule» не удалено (не было прав администратора). Его можно удалить вручную в «Брандмауэр Защитника Windows → Дополнительные параметры»." }
}

# 5. данные игры (логи, профиль окна) вне папки установки
$data = Join-Path $env:LOCALAPPDATA 'BabkaCoop'
$extra = ''
if ((Test-Path -LiteralPath $data) -and ((Resolve-Path -LiteralPath $data).Path -ne (Resolve-Path -LiteralPath $dir).Path)) { $extra = $data }

[void][System.Windows.Forms.MessageBox]::Show("Игра «Бабка: Кооп» удалена с компьютера.$fwNote`n`nСпасибо, что играли. Бабка будет скучать.", $title, 'OK', 'Information')

# 6. саму папку удаляем после выхода из скрипта
Set-Location $env:TEMP
$cmd = "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$dir`""
if ($extra) { $cmd += " & rmdir /s /q `"$extra`"" }
Start-Process -FilePath 'cmd.exe' -ArgumentList $cmd -WindowStyle Hidden
