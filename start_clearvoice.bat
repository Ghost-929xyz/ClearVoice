@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "BACKEND_PY=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "FRONTEND_URL=http://localhost:5173"

if /I "%~1"=="backend" goto run_backend
if /I "%~1"=="frontend" goto run_frontend

echo Starting ClearVoice...
echo.

call :prepare_backend
if errorlevel 1 goto failed

call :prepare_frontend
if errorlevel 1 goto failed

start "ClearVoice Backend" "%ComSpec%" /k call "%~f0" backend
start "ClearVoice Frontend" "%ComSpec%" /k call "%~f0" frontend

echo Waiting for the web page to start...
call :wait_for_frontend
start "" "%FRONTEND_URL%"

echo.
echo ClearVoice is starting. Backend and frontend are running in separate windows.
echo You can close those two windows to stop the services.
timeout /t 3 /nobreak >nul
exit /b 0

:prepare_backend
if not exist "%BACKEND_PY%" (
  echo Creating backend Python environment...
  py -3 -m venv "%BACKEND_DIR%\.venv"
  if errorlevel 1 (
    python -m venv "%BACKEND_DIR%\.venv"
  )
  if errorlevel 1 (
    echo Failed to create backend Python environment.
    exit /b 1
  )
)

"%BACKEND_PY%" -c "import fastapi, uvicorn, pydantic_settings, soundfile, openai" >nul 2>nul
if errorlevel 1 (
  echo Installing backend dependencies...
  "%BACKEND_PY%" -m pip install -r "%BACKEND_DIR%\requirements.txt"
  if errorlevel 1 (
    echo Failed to install backend dependencies.
    exit /b 1
  )
)
exit /b 0

:prepare_frontend
if not exist "%FRONTEND_DIR%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND_DIR%"
  call npm install
  if errorlevel 1 (
    popd
    echo Failed to install frontend dependencies.
    exit /b 1
  )
  popd
)
exit /b 0

:wait_for_frontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%FRONTEND_URL%'; $deadline=(Get-Date).AddSeconds(40); while ((Get-Date) -lt $deadline) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if ($response.StatusCode -ge 200) { exit 0 } } catch { Start-Sleep -Milliseconds 600 } }; exit 0" >nul 2>nul
exit /b 0

:run_backend
cd /d "%BACKEND_DIR%"
"%BACKEND_PY%" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
exit /b %ERRORLEVEL%

:run_frontend
cd /d "%FRONTEND_DIR%"
call npm run dev -- --host 127.0.0.1 --port 5173
exit /b %ERRORLEVEL%

:failed
echo.
echo ClearVoice failed to start. Please check the message above.
pause
exit /b 1
