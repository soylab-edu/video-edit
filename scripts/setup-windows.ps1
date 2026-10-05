param([switch]$SkipBandIt)
$ErrorActionPreference = 'Stop'
$moaRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $moaRoot
function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed ($LASTEXITCODE)" }
}
foreach ($tool in @('git', 'node', 'npm.cmd', 'ffmpeg', 'ffprobe', 'python')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool and reopen PowerShell." }
}
if ([int]((& node --version).TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node 24+ is required.' }
Invoke-Checked 'npm.cmd' @('ci')
Invoke-Checked 'python' @('-m', 'pip', 'install', 'uv==0.12.23')
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    Invoke-Checked 'python' @('-m', 'uv', 'venv', '--python', '3.12', '.venv')
}
Invoke-Checked 'python' @('-m', 'uv', 'pip', 'sync', '--python', '.venv/Scripts/python.exe', '--link-mode', 'copy', '--index-url', 'https://pypi.org/simple', '--extra-index-url', 'https://download.pytorch.org/whl/cpu', '--index-strategy', 'unsafe-best-match', 'requirements-audio.lock')
if (-not $SkipBandIt) {
    $moaBandIt = Join-Path $moaRoot '.data/vendor/bandit'
    $moaRevision = '840d5eb9ede59d64569c423244547e58cb00f647'
    if (-not (Test-Path -LiteralPath (Join-Path $moaBandIt '.git'))) {
        New-Item -ItemType Directory -Path $moaBandIt -Force | Out-Null
        Invoke-Checked 'git' @('init', $moaBandIt)
        Invoke-Checked 'git' @('-C', $moaBandIt, 'remote', 'add', 'origin', 'https://github.com/kwatcharasupat/bandit.git')
        Invoke-Checked 'git' @('-C', $moaBandIt, 'fetch', '--depth', '1', 'origin', $moaRevision)
        Invoke-Checked 'git' @('-C', $moaBandIt, 'checkout', '--detach', $moaRevision)
    }
    if ((& git -C $moaBandIt rev-parse HEAD) -ne $moaRevision) { throw 'Inspect the BandIt revision before changing it.' }
    if (-not (Test-Path -LiteralPath '.data/models/bandit/checkpoint.json')) {
        Invoke-Checked '.venv/Scripts/python.exe' @('scripts/setup-bandit.py', '--file', 'dnr-3s-mus64-l1snr.ckpt', '--config', 'dnr-3s-mus64-l1snr')
    }
    Invoke-Checked '.venv/Scripts/python.exe' @('scripts/bandit-runner.py', '--check')
}
if (-not (Test-Path -LiteralPath 'public/demo/assets.json')) { Invoke-Checked 'npm.cmd' @('run', 'demo') }
Invoke-Checked 'npx.cmd' @('playwright', 'install', 'chromium')
Invoke-Checked 'npm.cmd' @('run', 'build')
Write-Output 'Ready. Run start-moa.cmd or npm.cmd run dev:local.'
