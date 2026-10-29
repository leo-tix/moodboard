# Regénère le .zip téléchargeable de l'extension Chrome depuis apps/extension/,
# ET le marqueur de version qu'elle interroge pour savoir si une mise à jour
# est disponible (apps/web/public/extension-version.json — voir background.js,
# checkForUpdate). À relancer après toute modification des fichiers de
# l'extension, pour que le popup propose bien la mise à jour aux utilisateurs
# qui tournent encore sur l'ancienne version.
# Usage : pnpm zip:extension  (ou directement : powershell -File scripts/zip-extension.ps1)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "apps\extension"
$dest = Join-Path $root "apps\web\public\moodboard-extension.zip"
$manifestPath = Join-Path $source "manifest.json"
$versionDest = Join-Path $root "apps\web\public\extension-version.json"

if (Test-Path $dest) { Remove-Item $dest -Force }

Compress-Archive -Path (Join-Path $source "*") -DestinationPath $dest -CompressionLevel Optimal

Write-Host "OK -> $dest"

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
[PSCustomObject]@{ version = $manifest.version; notes = "" } |
  ConvertTo-Json | Set-Content $versionDest -Encoding utf8

Write-Host "OK -> $versionDest (version $($manifest.version))"
