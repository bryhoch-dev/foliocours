@echo off
chcp 65001 >nul
setlocal

echo ==================================================
echo   FolioCours - Serveur local PWA (port 8000)
echo ==================================================
echo.

set "SERVE_DIR=%~dp0"
if exist "%~dp0dist\index.html" (
  set "SERVE_DIR=%~dp0dist"
)

where python >nul 2>nul
if %errorlevel% neq 0 (
  where py >nul 2>nul
  if %errorlevel% neq 0 (
    echo [Erreur] Python est introuvable. Installez Python 3 pour lancer le serveur local.
    pause
    exit /b 1
  )
  set "PY_CMD=py -3"
) else (
  set "PY_CMD=python"
)

echo Dossier servi : %SERVE_DIR%
echo Ouverture de http://localhost:8000 ...
start "" "http://localhost:8000"

%PY_CMD% -m http.server 8000 --directory "%SERVE_DIR%"
