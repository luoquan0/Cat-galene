@echo off
setlocal
cd /d "%~dp0"
if not exist "data" mkdir "data"
if not exist "groups" mkdir "groups"
if not exist "data\config.json" (
    echo First launch: configure an administrator before starting the server.
    galenectl.exe -config data\galenectl.json -admin-username admin initial-setup -config data\config.json
    if errorlevel 1 (
        echo Initial setup failed.
        pause
        exit /b 1
    )
)
echo Starting Cat-galene at https://localhost:8443/
galene.exe -http :8443
echo Cat-galene has exited.
pause