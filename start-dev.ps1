[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDirectory = Join-Path $projectRoot 'backend'
$frontendDirectory = Join-Path $projectRoot 'front'
$backendPython = Join-Path $backendDirectory '.venv\Scripts\python.exe'
$frontendPackage = Join-Path $frontendDirectory 'package.json'
$frontendModules = Join-Path $frontendDirectory 'node_modules'

if (-not (Test-Path -LiteralPath $backendPython -PathType Leaf)) {
    throw "Ambiente Python não encontrado. Execute: cd backend; python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt"
}

if (-not (Test-Path -LiteralPath $frontendPackage -PathType Leaf)) {
    throw "Frontend não encontrado em: $frontendDirectory"
}

if (-not (Test-Path -LiteralPath $frontendModules -PathType Container)) {
    throw "Dependências do frontend não encontradas. Execute: cd front; npm install"
}

$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    throw 'npm.cmd não foi encontrado no PATH.'
}

$backendProcess = $null
$frontendProcess = $null

try {
    Write-Host 'Iniciando SFTP Explorer...' -ForegroundColor Cyan

    $backendProcess = Start-Process `
        -FilePath $backendPython `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--reload') `
        -WorkingDirectory $backendDirectory `
        -NoNewWindow `
        -PassThru

    $frontendProcess = Start-Process `
        -FilePath $npmCommand.Source `
        -ArgumentList @('run', 'dev') `
        -WorkingDirectory $frontendDirectory `
        -NoNewWindow `
        -PassThru

    Write-Host ''
    Write-Host 'Backend:  http://127.0.0.1:8000' -ForegroundColor Green
    Write-Host 'Swagger:  http://127.0.0.1:8000/docs' -ForegroundColor Green
    Write-Host 'Frontend: http://127.0.0.1:5173' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Pressione Ctrl+C para encerrar os dois servidores.' -ForegroundColor Yellow

    while (-not $backendProcess.HasExited -and -not $frontendProcess.HasExited) {
        Start-Sleep -Seconds 1
        $backendProcess.Refresh()
        $frontendProcess.Refresh()
    }

    if ($backendProcess.HasExited) {
        throw "O backend foi encerrado com o código $($backendProcess.ExitCode)."
    }

    throw "O frontend foi encerrado com o código $($frontendProcess.ExitCode)."
}
finally {
    foreach ($process in @($frontendProcess, $backendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host ''
    Write-Host 'Servidores encerrados.' -ForegroundColor Cyan
}

