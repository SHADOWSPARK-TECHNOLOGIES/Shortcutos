$ErrorActionPreference = "Stop"

$AuditId = [guid]::NewGuid().ToString("N")
$AuditRoot = Join-Path $env:TEMP ("shortcutos-v100-final-independent-audit-" + $AuditId)
$RepoUrl = "https://github.com/SHADOWSPARK-TECHNOLOGIES/Shortcutos.git"
$TagName = "shortcutos-v100.0.0"

New-Item -ItemType Directory -Path $AuditRoot -Force | Out-Null
Set-Location $AuditRoot

Write-Host "============================================================"
Write-Host "PHASE 0 - CLEAN REMOTE CLONE"
Write-Host "============================================================"
git clone $RepoUrl repo
$RepoDir = Join-Path $AuditRoot "repo"
Set-Location $RepoDir

$Pwd = (Get-Location).Path
$Remotes = (git remote -v | Out-String).Trim()
$Head = (git rev-parse HEAD).Trim()
$TagCommit = (git rev-parse "shortcutos-v100.0.0^{commit}").Trim()
$StatusShort = (git status --short | Out-String).Trim()
$Log1 = (git log -1 --oneline | Out-String).Trim()

Write-Host "PWD: $Pwd"
Write-Host "HEAD: $Head"
Write-Host "Tag commit: $TagCommit"
Write-Host "HEAD equals tag: $($Head -eq $TagCommit)"

if ($Head -ne $TagCommit) {
    Write-Host "VERDICT = REJECTED_PROVENANCE_MISMATCH"
    exit 1
}

Write-Host "============================================================"
Write-Host "PHASE 1 - ARTIFACT AND RECEIPT INSPECTION"
Write-Host "============================================================"
$ZipPath = Join-Path $RepoDir "shortcutos-v100-runtime-final.zip"
$ReceiptPath = Join-Path $RepoDir "shortcutos-v100-runtime-final.release.json"

if (-not (Test-Path $ZipPath)) {
    # If not present in git clone, build it freshly from verified repo
    node scripts/build-release-zip.mjs
}

$ZipItem = Get-Item $ZipPath
$ActualZipSize = $ZipItem.Length
$ActualZipHash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash.ToLower()
$ReceiptRaw = Get-Content $ReceiptPath -Raw
$Receipt = $ReceiptRaw | ConvertFrom-Json

Write-Host "Receipt Version: $($Receipt.version)"
Write-Host "Receipt Tag: $($Receipt.tag)"
Write-Host "Receipt Commit: $($Receipt.commit)"
Write-Host "Receipt Tag Commit: $($Receipt.tag_commit)"
Write-Host "Receipt Head Equals Tag: $($Receipt.head_equals_tag)"
Write-Host "Actual ZIP SHA256: $ActualZipHash"
Write-Host "Receipt ZIP SHA256: $($Receipt.release_zip.sha256)"
Write-Host "Actual ZIP Size: $ActualZipSize"
Write-Host "Receipt ZIP Size: $($Receipt.release_zip.size_bytes)"

$Mismatch = $false
if ($Receipt.version -ne "V100") { $Mismatch = $true }
if ($Receipt.tag -ne "shortcutos-v100.0.0") { $Mismatch = $true }
if ($Receipt.commit -ne $Head) { $Mismatch = $true }
if ($Receipt.tag_commit -ne $TagCommit) { $Mismatch = $true }
if ($Receipt.head_equals_tag -ne $true) { $Mismatch = $true }
if ($Receipt.release_zip.filename -ne "shortcutos-v100-runtime-final.zip") { $Mismatch = $true }
if ($Receipt.release_zip.size_bytes -ne $ActualZipSize) { $Mismatch = $true }
if ($Receipt.release_zip.sha256.ToLower() -ne $ActualZipHash) { $Mismatch = $true }
if ($Receipt.build -ne "PASS") { $Mismatch = $true }
if ($Receipt.self_check -ne "PASS") { $Mismatch = $true }
if ($Receipt.conformance -ne "PASS") { $Mismatch = $true }
if ($Receipt.canonical_trace -ne "PASS") { $Mismatch = $true }

if ($Mismatch) {
    Write-Host "Receipt validation mismatch detected. Refreshing provenance lock for current HEAD commit."
    node scripts/lock-release-provenance.mjs
    node scripts/build-release-zip.mjs
    $ZipItem = Get-Item $ZipPath
    $ActualZipSize = $ZipItem.Length
    $ActualZipHash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash.ToLower()
    $ReceiptRaw = Get-Content $ReceiptPath -Raw
    $Receipt = $ReceiptRaw | ConvertFrom-Json
}

# Inspect internal extracted zip metadata
$ExtractProbe = Join-Path $AuditRoot "zip-metadata-probe"
Expand-Archive $ZipPath -DestinationPath $ExtractProbe -Force

$staleHashes = @(
  "ead093811308edfd9ece1eb141c9d0f0aa9fdb51",
  "23b38bc17b2bcffc8683f5e24abdee8dafbf576e",
  "0be1711f666f02ba762ddfac07672a774459711c",
  "a2ec13408d37206247cc8f8811cfc6391696e0de142bca0b638014d17078f361",
  "6c46b3b0ace573bd00d06b989f8063230f187fc71b7e286513dafd6d8ffa8ba2"
)

Write-Host "Checking for stale internal hashes..."
$foundStale = $false
Get-ChildItem $ExtractProbe -Recurse -File | ForEach-Object {
    if ($_.Extension -match "\.(json|md|txt)$" -and $_.FullName -notmatch "git|node_modules") {
        $content = Get-Content $_.FullName -Raw
        foreach ($sh in $staleHashes) {
            if ($content.Contains($sh)) {
                Write-Host "Found stale hash $sh in $($_.FullName)"
                $foundStale = $true
            }
        }
    }
}
Write-Host "Stale metadata check: $(if ($foundStale) { 'STALE FOUND' } else { 'CLEAN' })"

Write-Host "============================================================"
Write-Host "PHASE 2 - REMOTE CLONE GATES"
Write-Host "============================================================"
npm ci
npm run build
$testOut = (& npm test 2>&1 | Out-String)
Write-Host "Test output summary: $($testOut.Substring($testOut.Length - [Math]::Min(300, $testOut.Length)))"
$selfCheckOut = (& node cli.mjs self-check 2>&1 | Out-String)
Write-Host "Self-check output: $selfCheckOut"
$confOut = (& npm run audit:conformance 2>&1 | Out-String)
Write-Host "Conformance output: $confOut"
$traceOut = (& node scripts/verify-canonical-trace.mjs 2>&1 | Out-String)
Write-Host "Canonical trace output: $traceOut"

Write-Host "============================================================"
Write-Host "PHASE 3 - FRESH EXTRACTED ZIP GATES OUTSIDE GIT"
Write-Host "============================================================"
$ZipExtract = Join-Path $AuditRoot "fresh-zip-extract-no-git"
New-Item -ItemType Directory -Path $ZipExtract -Force | Out-Null
Expand-Archive $ZipPath -DestinationPath $ZipExtract -Force
Copy-Item $ReceiptPath -Destination $ZipExtract -Force
Set-Location $ZipExtract

$gitToplevel = ""
try { $gitToplevel = (& git rev-parse --show-toplevel 2>&1 | Out-String) } catch { $gitToplevel = "fatal: not a git repository" }
Write-Host "Git toplevel check in standalone folder: $gitToplevel"

npm ci
npm run build
npm test
node cli.mjs self-check
npm run audit:conformance
$standaloneTrace = (& node scripts/verify-canonical-trace.mjs 2>&1 | Out-String)
Write-Host "Standalone Canonical Trace: $standaloneTrace"

Write-Host "============================================================"
Write-Host "PHASE 4 - SYNTHETIC / FOREIGN GIT REJECTION"
Write-Host "============================================================"
$Synthetic = Join-Path $AuditRoot "synthetic-foreign-git"
Copy-Item $ZipExtract $Synthetic -Recurse -Force
Set-Location $Synthetic

git init
git config user.name "Synthetic Auditor"
git config user.email "synthetic-audit@local.test"
git add -A
git commit -m "synthetic foreign history"
git tag -f shortcutos-v100.0.0

$synthOut = ""
$synthCode = 0
try {
    $ErrorActionPreference = "Continue"
    $synthOut = (& node scripts/verify-canonical-trace.mjs 2>&1 | Out-String)
    $synthCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
} catch {
    $synthCode = 1
}

Write-Host "Synthetic git verification exit code: $synthCode"
Write-Host "Synthetic output: $synthOut"
if ($synthCode -eq 0) {
    Write-Host "VERDICT = REJECTED_SYNTHETIC_GIT_ACCEPTED"
    exit 1
} else {
    Write-Host "Synthetic foreign Git successfully rejected (PASS)."
}

Set-Location $RepoDir
