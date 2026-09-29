# Бабка: Кооп — деинсталлятор. Бабка против.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'Удаление бабки (она это запомнит)'
$dir = $PSScriptRoot
$port = '__PORT__'
$app = 'Бабка Кооп'

function Say($t, $c = 'Gray', $d = 0) { Write-Host $t -ForegroundColor $c; if ($d) { Start-Sleep -Milliseconds $d } }
function Dots($t, $ms = 900) { Write-Host -NoNewline "  $t"; for ($i = 0; $i -lt 3; $i++) { Start-Sleep -Milliseconds ($ms / 3); Write-Host -NoNewline '.' }; Write-Host ' ok' -ForegroundColor Green }

Clear-Host
Say ''
Say '        .-"""-.' DarkGray
Say '       /  _ _  \      "Внучок... ты куда это собрался?"' DarkGray
Say '       | (o)(o) |' White
Say '       |   __   |' White
Say '        \ \__/ /' White
Say '         `----`' DarkGray
Say ''
Say '  Мастер удаления бабки, версия «Ну и пожалуйста»' Yellow
Say ''
$a = Read-Host '  Вы действительно хотите удалить бабку? (да/нет)'
if ($a -notmatch '^\s*(д|да|y|yes|lf)\s*$') {
  Say ''
  Say '  Бабка рада, что вы остались. Держите пирожок.' Green
  Say '         (  )' Yellow
  Say '      .-(    )-.' Yellow
  Say '     (__________)' Yellow
  Say ''
  Read-Host '  Нажмите Enter'
  exit
}
$b = Read-Host '  Точно? Она пирожки напекла... (да/нет)'
if ($b -notmatch '^\s*(д|да|y|yes|lf)\s*$') { Say '  Правильно. Пирожки остынут.' Green; Read-Host '  Нажмите Enter'; exit }

Say ''
Say '  Хорошо. Бабка собирает вещи:' Cyan
Dots 'Складывает тапки в пакет'
Dots 'Забирает биту (на память)'
Dots 'Снимает капканы (кажется, все)'
Dots 'Выключает скрипучие половицы'

# ярлыки
$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$app.lnk"
if (Test-Path $desk) { Remove-Item $desk -Force }
$sm = Join-Path ([Environment]::GetFolderPath('Programs')) $app
if (Test-Path $sm) { Remove-Item $sm -Recurse -Force }
Dots 'Стирает ярлыки со стола'

# «Программы и компоненты»
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BabkaCoop' -Recurse -Force -ErrorAction SilentlyContinue
Dots 'Выписывается из реестра'

# брандмауэр (нужны права администратора)
$rule = "Babka Coop (TCP $port)"
$has = Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
if ($has) {
  Say '  Сейчас Windows попросит права — это чтобы закрыть порт в брандмауэре.' DarkYellow
  try {
    Start-Process -FilePath 'netsh.exe' -ArgumentList "advfirewall firewall delete rule name=`"$rule`"" -Verb RunAs -WindowStyle Hidden -Wait
    Dots 'Закрывает за собой дверь (порт)'
  } catch { Say '  Порт остался открыт (вы не дали прав). Правило можно удалить вручную.' DarkYellow }
}

Say ''
Say '  Бабка ушла, громко хлопнув дверью. БАМ.' Red
Say '  ...но она вернётся. Они всегда возвращаются.' DarkGray
Say ''
Read-Host '  Нажмите Enter, чтобы закончить'

# удаляем папку уже после выхода из скрипта
Set-Location $env:TEMP
Start-Process -FilePath 'cmd.exe' -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$dir`"" -WindowStyle Hidden
