$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\wonde\.gemini\antigravity\scratch\shortcutos-v100-runtime"
$RepoUrl = "https://github.com/SHADOWSPARK-TECHNOLOGIES/Shortcutos.git"
$TagName = "shortcutos-v100.0.0"

Set-Location $ProjectRoot

Write-Host "=== Confirm local release state ==="
git status --short
git rev-parse HEAD
git rev-parse $TagName

Write-Host "=== Confirm release artifacts ==="
Get-Item ".\shortcutos-v100-runtime-final.zip"
Get-FileHash ".\shortcutos-v100-runtime-final.zip" -Algorithm SHA256
Get-Content ".\shortcutos-v100-runtime-final.release.json" -Raw

Write-Host "=== Configure GitHub remote ==="
if (-not (Test-Path ".git")) {
  git init -b main
}

$remote = ""
try { 
  $remote = (& git remote get-url origin 2>&1).ToString().Trim() 
} catch { 
  $remote = "" 
}

if ($remote -and $LASTEXITCODE -eq 0) {
  git remote set-url origin $RepoUrl
} else {
  git remote add origin $RepoUrl
}

git remote -v

Write-Host "=== Safety check: no secrets staged ==="
git status --short

$secretFiles = Get-ChildItem . -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch "\\.git\\|\\node_modules\\|\\dist\\|\\audit\\final-readiness\\" -and (
      $_.Name -eq ".env" -or
      ($_.Name -like ".env.*" -and $_.Name -notlike "*.example") -or
      $_.Name -match "\.(pem|key|p12|pfx)$" -or
      $_.Name -match "^id_rsa"
    )
  }

if ($secretFiles.Count -gt 0) {
  $secretFiles | Select-Object FullName | Format-Table -AutoSize
  throw "Secret-like files detected. Stop before pushing."
}

Write-Host "=== Ensure everything is committed ==="
git add -A

$null = & git diff --cached --quiet 2>&1
if ($LASTEXITCODE -eq 1) {
  git commit -m "release(v100): final verified runtime and readiness evidence"
} else {
  Write-Host "No staged changes."
  $global:LASTEXITCODE = 0
}

$Head = (git rev-parse HEAD).Trim()

Write-Host "=== Bind release tag to HEAD ==="
git tag -f $TagName $Head

Write-Host "=== Initial import into empty GitHub repo ==="
git branch -M main
git push -u origin main
git push origin $TagName --force

Write-Host "=== Optional: also preserve remediation branch on GitHub ==="
git push origin HEAD:refs/heads/remediation/v100-final-readiness-20260829-140313

Write-Host "=== Final pushed state ==="
Write-Host "Repo: https://github.com/SHADOWSPARK-TECHNOLOGIES/Shortcutos"
Write-Host "Main commit: $Head"
Write-Host "Tag: $TagName"
Write-Host "Release ZIP SHA-256:"
(Get-FileHash ".\shortcutos-v100-runtime-final.zip" -Algorithm SHA256).Hash.ToLower()
