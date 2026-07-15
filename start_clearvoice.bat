@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "BACKEND_PY=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "FRONTEND_URL=http://localhost:5173"
set "BACKEND_URL=http://127.0.0.1:8000/api/health"

if /I "%~1"=="backend" goto run_backend
if /I "%~1"=="frontend" goto run_frontend

echo Starting ClearVoice...
echo.

call :stop_port 8000
call :stop_port 5173

call :prepare_backend
if errorlevel 1 goto failed

call :prepare_frontend
if errorlevel 1 goto failed

start "ClearVoice Backend" "%ComSpec%" /k call "%~f0" backend
start "ClearVoice Frontend" "%ComSpec%" /k call "%~f0" frontend

echo Waiting for the web page to start...
call :wait_for_backend
call :wait_for_frontend
start "" "%FRONTEND_URL%"

echo.
echo ClearVoice is starting. Backend and frontend are running in separate windows.
echo You can close those two windows to stop the services.
timeout /t 3 /nobreak >nul
exit /b 0

:prepare_backend
if not exist "%BACKEND_PY%" (
  echo Creating backend Python 3.11 environment...
  py -3.11 -m venv "%BACKEND_DIR%\.venv"
  if errorlevel 1 (
    echo Python 3.11 was not found. Please install Python 3.11 and retry.
    echo Download: https://www.python.org/downloads/release/python-3119/
    exit /b 1
  )
)

"%BACKEND_PY%" -m pip --version >nul 2>nul
if errorlevel 1 (
  echo Backend Python environment is invalid. Please delete backend\.venv and retry.
  exit /b 1
)

"%BACKEND_PY%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" >nul 2>nul
if errorlevel 1 (
  echo Backend must use Python 3.11 for DeepFilterNet compatibility.
  echo Please delete backend\.venv and run this script again after installing Python 3.11.
  exit /b 1
)

"%BACKEND_PY%" -c "import fastapi, uvicorn, pydantic_settings, soundfile, openai, df, torch, torchaudio" >nul 2>nul
if errorlevel 1 (
  echo Installing backend dependencies...
  "%BACKEND_PY%" -m pip install -U pip setuptools
  if errorlevel 1 (
    echo Failed to upgrade backend packaging tools.
    exit /b 1
  )
  "%BACKEND_PY%" -m pip install "wheel<0.47"
  if errorlevel 1 (
    echo Failed to install wheel.
    exit /b 1
  )
  "%BACKEND_PY%" -m pip install -r "%BACKEND_DIR%\requirements.txt"
  if errorlevel 1 (
    echo Failed to install backend dependencies.
    exit /b 1
  )
  "%BACKEND_PY%" -c "import torch, torchaudio; print(torch.__version__, torchaudio.__version__)" >nul 2>nul
  if errorlevel 1 (
    echo Failed to import PyTorch or torchaudio.
    exit /b 1
  )
)

pushd "%BACKEND_DIR%"
"%BACKEND_PY%" -c "from app.main import app; print(app.title)" >nul 2>nul
set "BACKEND_IMPORT_ERROR=%ERRORLEVEL%"
popd
if not "%BACKEND_IMPORT_ERROR%"=="0" (
  echo Backend app import failed. Please run the backend command manually to inspect the error:
  echo cd /d "%BACKEND_DIR%"
  echo "%BACKEND_PY%" -c "from app.main import app; print(app.title)"
  exit /b 1
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

:wait_for_backend
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%BACKEND_URL%'; $deadline=(Get-Date).AddSeconds(40); while ((Get-Date) -lt $deadline) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if ($response.StatusCode -ge 200) { exit 0 } } catch { Start-Sleep -Milliseconds 600 } }; exit 0" >nul 2>nul
exit /b 0

:stop_port
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%~1; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul
exit /b 0

:run_backend
cd /d "%BACKEND_DIR%"
"%BACKEND_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
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
