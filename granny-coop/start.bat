@echo off
chcp 65001 >nul
title Бабка: Кооп — сервер (не закрывайте, пока играете)
cd /d "%~dp0"

rem 1) встроенный Node.js (кладёт установщик) 2) системный Node.js
set "NODE_EXE="
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul && set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo.
  echo  [!] Не найден Node.js — без него сервер игры не запустится.
  echo      Запустите SETUP.bat ^(установщик сам скачает Node.js^)
  echo      или поставьте Node.js LTS с https://nodejs.org
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

"%NODE_EXE%" server\index.js %*
echo.
echo  Сервер остановлен.
pause
