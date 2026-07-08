# Regénère le .zip téléchargeable de l'extension Chrome depuis apps/extension/.
# À relancer après toute modification des fichiers de l'extension.
# Usage : pnpm zip:extension  (ou directement : powershell -File scripts/zip-extension.ps1)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "apps\extension"
$dest = Join-Path $root "apps\web\public\moodboard-extension.zip"

if (Test-Path $dest) { Remove-Item $dest -Force }

Compress-Archive -Path (Join-Path $source "*") -DestinationPath $dest -CompressionLevel Optimal

Write-Host "OK -> $dest"
