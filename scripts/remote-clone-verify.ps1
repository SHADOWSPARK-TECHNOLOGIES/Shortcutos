$ErrorActionPreference = "Stop"

$CloneDir = Join-Path $env:TEMP "shortcutos-remote-clone-final"
Write-Host "=== 1. Fresh clone from GitHub ==="
if (Test-Path $CloneDir) {
    Remove-Item -Recurse -Force $CloneDir
}

git clone https://github.com/SHADOWSPARK-TECHNOLOGIES/Shortcutos.git $CloneDir
Set-Location $CloneDir

Write-Host "=== 2. Remote commit & tag validation ==="
$Head = (git rev-parse HEAD).Trim()
$Tag = (git rev-parse shortcutos-v100.0.0).Trim()
Write-Host "Cloned HEAD: $Head"
Write-Host "Tag target:  $Tag"
Write-Host "HEAD equals tag: $($Head -eq $Tag)"

Write-Host "=== 3. Dependency install ==="
if (Test-Path "package-lock.json") {
    npm ci
} else {
    npm install
}

Write-Host "=== 4. Build ==="
npm run build

Write-Host "=== 5. Tests ==="
npm test

Write-Host "=== 6. Self-check ==="
node cli.mjs self-check

Write-Host "=== 7. Conformance ==="
npm run audit:conformance

Write-Host "=== 8. Canonical trace verification ==="
node scripts/verify-canonical-trace.mjs

Write-Host "=== 9. Confirm release bundle & receipt ==="
if (Test-Path "scripts\build-release-zip.mjs") {
    node scripts/build-release-zip.mjs
}

$ZipItem = Get-Item "shortcutos-v100-runtime-final.zip"
$ZipHash = (Get-FileHash $ZipItem.FullName -Algorithm SHA256).Hash.ToLower()
$ReceiptContent = Get-Content "shortcutos-v100-runtime-final.release.json" -Raw

Write-Host ""
Write-Host "=== SUMMARY ==="
Write-Host "Cloned repo HEAD: $Head"
Write-Host "Tag target: $Tag"
Write-Host "HEAD equals tag: $($Head -eq $Tag)"
Write-Host "ZIP size: $($ZipItem.Length) bytes"
Write-Host "ZIP SHA-256: $ZipHash"
Write-Host "External receipt:"
Write-Host $ReceiptContent
