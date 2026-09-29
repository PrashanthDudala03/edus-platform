$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$localNode = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.tools') -Directory | Where-Object { $_.Name -like 'node-*-win-x64' } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $localNode) { throw 'Local Node.js is missing. Install Node.js 24 or use Docker builds.' }
$env:PATH = $localNode.FullName + ';' + (Join-Path $projectRoot '.tools/dotnet') + ';' + $env:PATH
$env:DOTNET_ROOT = Join-Path $projectRoot '.tools/dotnet'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
Set-Location -LiteralPath $projectRoot
node --version
dotnet --version
