@echo off
chcp 65001 >nul
rem Открывает порт игры во входящих правилах брандмауэра Windows (нужно, чтобы друг по Radmin VPN мог подключиться).
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Запрашиваю права администратора...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%1' -Verb RunAs"
  exit /b
)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=7777"
netsh advfirewall firewall delete rule name="Babka Coop (TCP %PORT%)" >nul 2>&1
netsh advfirewall firewall add rule name="Babka Coop (TCP %PORT%)" dir=in action=allow protocol=TCP localport=%PORT% profile=any
if %errorlevel%==0 (
  echo.
  echo  Готово! Порт %PORT% открыт. Теперь друг может подключиться по адресу из лобби.
) else (
  echo  Не получилось добавить правило.
)
echo.
pause
