@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "DESKTOP_DIR=%ROOT%desktop"
set "BACKEND_PY=%BACKEND_DIR%\.venv\Scripts\python.exe"

echo Starting ClearVoice Desktop...
echo.

if not exist "%BACKEND_PY%" (
  echo Backend virtual environment was not found. Run start_clearvoice.bat once first.
  pause
  exit /b 1
)

pushd "%BACKEND_DIR%"
"%BACKEND_PY%" -c "from app.main import app; print(app.title)" >nul 2>nul
set "BACKEND_IMPORT_ERROR=%ERRORLEVEL%"
popd
if not "%BACKEND_IMPORT_ERROR%"=="0" (
  echo Backend import failed. Run start_clearvoice.bat or reinstall backend dependencies first.
  pause
  exit /b 1
)

if not exist "%FRONTEND_DIR%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND_DIR%"
  call npm install
  if errorlevel 1 exit /b 1
  popd
)

echo Building frontend...
pushd "%FRONTEND_DIR%"
call npm run build
if errorlevel 1 exit /b 1
popd

if not exist "%DESKTOP_DIR%\node_modules" (
  echo Installing Electron dependencies...
  pushd "%DESKTOP_DIR%"
  call npm install
  if errorlevel 1 exit /b 1
  popd
)

pushd "%DESKTOP_DIR%"
call npm run start
popd
