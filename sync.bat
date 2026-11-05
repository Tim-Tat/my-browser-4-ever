@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title My Browser 4 Ever - Sync

REM Synchronisiert den lokalen Ordner mit GitHub (Tim-Tat/my-browser-4-ever).
REM - Holt immer die neuesten Aenderungen von GitHub (pull --rebase, lokale Aenderungen werden zwischengespeichert).
REM - Auf einem Feature-Branch: lokale Aenderungen werden committet und gepusht.
REM - Auf main: es wird NUR gepullt (laut AGENTS.md laufen Aenderungen per Pull Request).

set REPO=https://github.com/Tim-Tat/my-browser-4-ever.git

where git >nul 2>&1 || (echo Git wurde nicht gefunden. & goto :end)

if not exist ".git" (
    echo Kein Git-Repository gefunden - klone von GitHub...
    git clone %REPO% . || goto :end
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo Branch: %BRANCH%
echo.

echo [1/3] Hole Aenderungen von GitHub...
git fetch --all --prune || goto :end

echo [2/3] Aktualisiere lokalen Stand...
git pull --rebase --autostash origin %BRANCH% 2>nul
if errorlevel 1 (
    echo Hinweis: Kein Remote-Branch "%BRANCH%" oder Konflikt - bitte pruefen.
)

echo [3/3] Lokale Aenderungen senden...
if /i "%BRANCH%"=="main" (
    echo Auf main wird nicht gepusht. Fuer Aenderungen bitte einen Branch + Pull Request nutzen.
    goto :status
)

git status --porcelain | findstr "." >nul
if not errorlevel 1 (
    set "MSG=%*"
    if "!MSG!"=="" set "MSG=sync: %DATE% %TIME%"
    git add -A
    git commit -m "!MSG!"
)
git push -u origin %BRANCH% || echo Push fehlgeschlagen.

:status
echo.
git status -sb
:end
echo.
pause
