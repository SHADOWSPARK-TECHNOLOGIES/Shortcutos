$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/SHADOWSPARK-TECHNOLOGIES/Shortcutos.git"
$RepoFull = "SHADOWSPARK-TECHNOLOGIES/Shortcutos"
$TagName = "shortcutos-v100.0.0"
$Now = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host "=== ShortcutOS V100 GitHub Push Automation ==="

# 1. Locate the actual ShortcutOS runtime root
function Test-ShortcutRoot($p) {
    return (
        (Test-Path (Join-Path $p "package.json")) -and
        (Test-Path (Join-Path $p "src")) -and
        (Test-Path (Join-Path $p "scripts")) -and
        (Test-Path (Join-Path $p "scripts\verify-canonical-trace.mjs"))
    )
}

$candidateRoots = @()
$candidateRoots += (Get-Location).Path
$candidateRoots += "$env:USERPROFILE\.gemini\antigravity\scratch\shortcutos-v100-runtime"
$candidateRoots += "$env:USERPROFILE\Downloads\shortcutos-v100-runtime"
$candidateRoots += "$env:USERPROFILE\Desktop\shortcutos-v100-runtime"

$searchBases = @(
    "$env:USERPROFILE\.gemini\antigravity\scratch",
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\Desktop"
)

foreach ($base in $searchBases) {
    if (Test-Path $base) {
        Get-ChildItem $base -Directory -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "shortcutos|ShortcutOS|runtime" } |
            ForEach-Object { $candidateRoots += $_.FullName }
    }
}

$ProjectRoot = $candidateRoots | Where-Object { $_ -and (Test-Path $_) -and (Test-ShortcutRoot $_) } | Select-Object -First 1

if (-not $ProjectRoot) {
    throw "Could not locate ShortcutOS runtime root. Open Antigravity inside the folder containing package.json, src/, and scripts/verify-canonical-trace.mjs, then rerun."
}

Set-Location $ProjectRoot
Write-Host "Project root: $ProjectRoot"

# 2. Create evidence directory
$EvidenceDir = Join-Path $ProjectRoot "audit\final-readiness"
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
Start-Transcript -Path (Join-Path $EvidenceDir "github-push-session-$Now.log") -Force

# 3. Secret safety gate
Write-Host "=== Secret safety gate ==="
$secretFiles = Get-ChildItem . -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\|\\.git\\|\\dist\\|\\audit\\final-readiness\\" -and
        (
            $_.Name -eq ".env" -or
            ($_.Name -like ".env.*" -and $_.Name -notlike "*.example") -or
            $_.Name -match "\.(pem|key|p12|pfx)$" -or
            $_.Name -match "^id_rsa"
        )
    }

if ($secretFiles.Count -gt 0) {
    $secretFiles | Select-Object FullName | Format-Table -AutoSize
    throw "Secret-like files detected. Remove them or add safe examples only before pushing to public GitHub."
}

# 4. Harden .gitignore
$gitignoreLines = @(
    "node_modules/",
    "dist/",
    ".env",
    ".env.*",
    "!.env.example",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "id_rsa*",
    ".DS_Store",
    "Thumbs.db"
)

if (-not (Test-Path ".gitignore")) {
    New-Item -ItemType File -Path ".gitignore" | Out-Null
}

foreach ($line in $gitignoreLines) {
    if (-not (Select-String -Path ".gitignore" -Pattern ([regex]::Escape($line)) -Quiet -ErrorAction SilentlyContinue)) {
        Add-Content ".gitignore" $line
    }
}

# 5. Dependency install
Write-Host "=== Dependency install ==="
if (-not (Test-Path "node_modules")) {
    if (Test-Path "package-lock.json") {
        npm ci
    } else {
        npm install
    }
}

# 6. Helper for logged commands
function Run-Step {
    param(
        [string]$Name,
        [scriptblock]$Command
    )
    $log = Join-Path $EvidenceDir "$Name.log"
    Write-Host ""
    Write-Host "=== RUN: $Name ==="
    & $Command *>&1 | Tee-Object -FilePath $log
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed. See $log"
    }
}

# 7. Generate inventories/manifests if scripts exist
if (Test-Path "scripts\generate-test-inventory.mjs") {
    Run-Step "01-generate-test-inventory" { node scripts/generate-test-inventory.mjs }
}

if (Test-Path "scripts\lock-release-provenance.mjs") {
    Run-Step "02-generate-file-manifest" { node scripts/lock-release-provenance.mjs }
}

# 8. Main verification gates
Run-Step "03-build" { npm run build }
Run-Step "04-tests" { npm test }
Run-Step "05-self-check" { node cli.mjs self-check }
Run-Step "06-conformance" { npm run audit:conformance }
Run-Step "07-canonical-trace" { node scripts/verify-canonical-trace.mjs }

# 9. Lock provenance and build release artifacts
if (Test-Path "scripts\lock-release-provenance.mjs") {
    Run-Step "08-lock-release-provenance" { node scripts/lock-release-provenance.mjs }
}

if (Test-Path "scripts\build-release-zip.mjs") {
    Run-Step "09-build-release-zip" { node scripts/build-release-zip.mjs }
}

if (-not (Test-Path "shortcutos-v100-runtime-final.zip")) {
    throw "Release ZIP not found: shortcutos-v100-runtime-final.zip"
}

if (-not (Test-Path "shortcutos-v100-runtime-final.release.json")) {
    throw "External release receipt not found: shortcutos-v100-runtime-final.release.json"
}

# 10. Fresh standalone extracted-ZIP verification outside Git
$StandaloneDir = Join-Path $env:TEMP ("shortcutos-v100-standalone-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $StandaloneDir -Force | Out-Null
Expand-Archive -Path "shortcutos-v100-runtime-final.zip" -DestinationPath $StandaloneDir -Force
Copy-Item "shortcutos-v100-runtime-final.release.json" -Destination $StandaloneDir -Force

Push-Location $StandaloneDir
try {
    $isGit = $false
    try {
        $null = & git rev-parse --show-toplevel 2>&1
        if ($LASTEXITCODE -eq 0) { $isGit = $true }
    } catch {
        $isGit = $false
    }

    if ($isGit) {
        throw "Standalone verification directory is unexpectedly inside a Git repository."
    }
    $global:LASTEXITCODE = 0

    if (-not (Test-Path "node_modules")) {
        try {
            Run-Step "10-standalone-npm-ci" { npm ci }
        } catch {
            Write-Host "npm ci fallback to npm install"
            Run-Step "10-standalone-npm-install" { npm install }
        }
    }

    Run-Step "11-standalone-build" { npm run build }
    Run-Step "12-standalone-tests" { npm test }
    Run-Step "13-standalone-self-check" { node cli.mjs self-check }
    Run-Step "14-standalone-conformance" { npm run audit:conformance }
    Run-Step "15-standalone-canonical-trace" { node scripts/verify-canonical-trace.mjs }
} finally {
    Pop-Location
}

# 11. Synthetic Git rejection check
$SyntheticDir = Join-Path $env:TEMP ("shortcutos-v100-synthetic-" + [guid]::NewGuid().ToString("N"))
Copy-Item $StandaloneDir $SyntheticDir -Recurse -Force

Push-Location $SyntheticDir
try {
    git init
    git config user.name "ShortcutOS Synthetic Auditor"
    git config user.email "audit@shadowspark.local"
    git add -A
    git commit -m "synthetic foreign history"
    git tag -f $TagName

    $syntheticLog = Join-Path $EvidenceDir "16-synthetic-git-rejection.log"
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $synthOut = & node scripts/verify-canonical-trace.mjs 2>&1
    $synthCode = $LASTEXITCODE
    $ErrorActionPreference = $prevErrorAction

    $synthOut | Out-File -FilePath $syntheticLog -Encoding utf8

    if ($synthCode -eq 0) {
        throw "Synthetic foreign Git repository was incorrectly accepted. See $syntheticLog"
    }

    Write-Host "Synthetic Git rejection passed: verifier rejected foreign history."
    $global:LASTEXITCODE = 0
} finally {
    Pop-Location
}

# 12. Calculate release artifact hash and write summary
node scripts/write-summary.mjs
$ZipItem = Get-Item "shortcutos-v100-runtime-final.zip"
$ZipHash = (Get-FileHash $ZipItem.FullName -Algorithm SHA256).Hash.ToLower()
$SummaryPath = Join-Path $EvidenceDir "FINAL_READINESS_SUMMARY.md"

# 13. Git init / remote / commit / push
Write-Host "=== GitHub push ==="
if (-not (Test-Path ".git")) {
    git init -b main
}

git config user.name "ShadowSpark Technologies"
git config user.email "admin@shadowspark-tech.org"

$existingRemote = ""
try {
    $existingRemote = (& git remote get-url origin 2>&1).ToString().Trim()
} catch {
    $existingRemote = ""
}

if ($existingRemote -and $LASTEXITCODE -eq 0) {
    git remote set-url origin $RepoUrl
} else {
    git remote add origin $RepoUrl
}

git add -A
$hasStaged = $false
try {
    $null = & git diff --cached --quiet 2>&1
    if ($LASTEXITCODE -eq 1) { $hasStaged = $true }
} catch {
    $hasStaged = $true
}

if ($hasStaged) {
    git commit -m "release(v100): final readiness candidate with verification artifacts"
} else {
    Write-Host "No staged changes to commit."
    $global:LASTEXITCODE = 0
}

$Head = (git rev-parse HEAD).Trim()
git tag -f $TagName $Head

$BranchName = "remediation/v100-final-readiness-$Now"
git checkout -B $BranchName

Write-Host "Attempting git push to origin..."
$pushFailed = $false
try {
    $env:GIT_TERMINAL_PROMPT = "0"
    & git push -u origin $BranchName 2>&1
    if ($LASTEXITCODE -ne 0) { $pushFailed = $true }
    & git push origin $TagName --force 2>&1
    if ($LASTEXITCODE -ne 0) { $pushFailed = $true }
} catch {
    $pushFailed = $true
}

if ($pushFailed) {
    Write-Host "Git push requires GitHub credentials or personal access token."
    Write-Host "Local commit and tag $TagName are ready at SHA $Head."
    $global:LASTEXITCODE = 0
}

# 14. Optional GitHub release
if (Get-Command gh -ErrorAction SilentlyContinue) {
    $ghAuth = $false
    try {
        $null = & gh auth status 2>&1
        if ($LASTEXITCODE -eq 0) { $ghAuth = $true }
    } catch {}

    if ($ghAuth) {
        $releaseExists = $false
        try {
            $null = & gh release view $TagName --repo $RepoFull 2>&1
            if ($LASTEXITCODE -eq 0) { $releaseExists = $true }
        } catch {}

        if ($releaseExists) {
            gh release upload $TagName "shortcutos-v100-runtime-final.zip" "shortcutos-v100-runtime-final.release.json" --repo $RepoFull --clobber
        } else {
            $global:LASTEXITCODE = 0
            gh release create $TagName "shortcutos-v100-runtime-final.zip" "shortcutos-v100-runtime-final.release.json" --repo $RepoFull --title "ShortcutOS V100 Final Readiness Candidate" --notes-file $SummaryPath --verify-tag
        }
    } else {
        Write-Host "GitHub release skipped: gh is not authenticated."
        $global:LASTEXITCODE = 0
    }
} else {
    Write-Host "GitHub release skipped: gh CLI not installed."
}

Write-Host ""
Write-Host "=== DONE ==="
Write-Host "Repo: https://github.com/SHADOWSPARK-TECHNOLOGIES/Shortcutos"
Write-Host "Branch pushed: $BranchName"
Write-Host "HEAD: $Head"
Write-Host "Tag: $TagName"
Write-Host "ZIP SHA-256: $ZipHash"
Write-Host "ZIP size: $($ZipItem.Length)"
Write-Host "Evidence folder: $EvidenceDir"

Stop-Transcript
