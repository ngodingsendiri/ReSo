#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Package ReSo extension as .crx with a stable extension ID.

.DESCRIPTION
    Uses Chrome's --pack-extension to produce a .crx file and a signing key.
    The signing key ensures a stable extension ID across all installations
    (needed for push via externally_connectable).

    First run: generates key.pem + reso-extension.crx
    Subsequent runs: reuses key.pem → same extension ID every time.

.PARAMETER ExtensionDir
    Path to the built extension directory (default: extension/dist)

.PARAMETER OutputDir
    Where to place the .crx + key.pem (default: extension/dist-crx)

.EXAMPLE
    pwsh scripts/package-ext.crx.ps1
    pwsh scripts/package-ext.crx.ps1 -ExtensionDir extension/dist -OutputDir extension/dist-crx
#>
param(
    [string]$ExtensionDir = "extension/dist",
    [string]$OutputDir = "extension/dist-crx"
)

$ErrorActionPreference = "Stop"

# ── Locate Chrome ──
$chromePaths = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
    # Try PATH
    $chrome = Get-Command chrome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}
if (-not $chrome) {
    $chrome = Get-Command "chrome.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if (-not $chrome) {
    Write-Error "Chrome tidak ditemukan. Install Google Chrome atau set PATH."
    exit 1
}

Write-Host "Chrome: $chrome" -ForegroundColor Cyan

# ── Validate extension dir ──
$extPath = (Resolve-Path $ExtensionDir).Path
if (-not (Test-Path "$extPath\manifest.json")) {
    Write-Error "manifest.json tidak ada di $extPath - jalankan build dulu."
    exit 1
}

# ── Ensure output dir exists ──
$outPath = (Resolve-Path $OutputDir -ErrorAction SilentlyContinue)
if (-not $outPath) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    $outPath = (Resolve-Path $OutputDir).Path
}

# ── Signing key ──
$keyPath = Join-Path $outPath "reso-extension-key.pem"
if (-not (Test-Path $keyPath)) {
    Write-Host "Generating new signing key..." -ForegroundColor Yellow
}

# ── Pack ──
Write-Host "Packing $extPath ..." -ForegroundColor Cyan

$chromeArgs = @("--pack-extension=$extPath")
if (Test-Path $keyPath) {
    $chromeArgs += "--pack-extension-key=$keyPath"
}

$proc = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -Wait -PassThru -WindowStyle Hidden

# Chrome --pack-extension outputs the .crx next to the extension dir
$crxName = Split-Path $extPath -Leaf
$crxFile = Join-Path (Split-Path $extPath -Parent) "$crxName.crx"

# Wait briefly for file to appear
$retries = 0
while (-not (Test-Path $crxFile) -and $retries -lt 10) {
    Start-Sleep -Milliseconds 500
    $retries++
}

if (-not (Test-Path $crxFile)) {
    # Also check output dir
    $altCrx = Join-Path $outPath "$crxName.crx"
    if (Test-Path $altCrx) {
        $crxFile = $altCrx
    } else {
        Write-Error "CRX file not generated. Chrome exit code: $($proc.ExitCode)"
        exit 1
    }
}

# ── Move .crx to output dir ──
$destCrx = Join-Path $outPath "$crxName.crx"
if ($crxFile -ne $destCrx) {
    Copy-Item $crxFile $destCrx -Force
    Remove-Item $crxFile -Force -ErrorAction SilentlyContinue
}

# ── Move key to output dir if Chrome placed it elsewhere ──
$chromeKey = Join-Path (Split-Path $extPath -Parent) "$crxName.pem"
if ((Test-Path $chromeKey) -and $chromeKey -ne $keyPath) {
    Copy-Item $chromeKey $keyPath -Force
    Remove-Item $chromeKey -Force -ErrorAction SilentlyContinue
}

# ── Extract extension ID ──
# Chrome extension ID = SHA256(public_key_spki_der)[:16] -> hex -> map ke a-p
# (0->a, 1->b, ..., 9->j, a->k, ..., f->p). Pakai Python + cryptography
# (cara paling akurat; .NET Framework 4.8 tidak punya ImportPkcs8PrivateKey).
$extId = ""
$pyHelper = Join-Path $PSScriptRoot "compute_ext_id.py"
if (Test-Path $keyPath) {
    try {
        $extId = (& python $pyHelper $keyPath 2>$null | Out-String).Trim()
    } catch {
        $extId = ""
    }
    if ($extId -notmatch '^[a-p]{32}$') {
        Write-Host "  (gagal hitung ID via Python, pakai fallback hex)" -ForegroundColor Yellow
        $extId = ""
    }
}
if (-not $extId) {
    # Fallback: hash private key bytes (bukan standar Chrome, tapi tetap 32 char)
    try {
        $pemContent = Get-Content $keyPath -Raw
        $base64Key = ($pemContent -replace "-----.*-----", "" -replace "\s", "")
        $keyBytes = [Convert]::FromBase64String($base64Key)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hash = $sha.ComputeHash($keyBytes)
        $extId = ($hash[0..15] | ForEach-Object { $_.ToString("x2") }) -join ""
    } catch {
        $extId = ""
    }
}

Write-Host ""
Write-Host "=== Packaging Complete ===" -ForegroundColor Green
Write-Host "CRX:       $destCrx"
Write-Host "Key:       $keyPath"
if ($extId) {
    Write-Host "Extension ID: $extId" -ForegroundColor Yellow

    # ── Replace placeholder / ID lama di install.html dengan ID baru ──
    $installSrc = Join-Path $PSScriptRoot "..\public\install.html"
    $installDest = Join-Path $outPath "install.html"
    if (Test-Path $installSrc) {
        $html = Get-Content $installSrc -Raw
        # Ganti placeholder (baru) atau ID 32 karakter lama (a-p/hex) supaya selalu
        # sinkron dengan key saat ini — aman dipakai ulang berkali-kali.
        $html = $html -replace "extId\s*=\s*['""]__EXTENSION_ID__['""]", "extId = '$extId'"
        $html = $html -replace "extId\s*=\s*['""][a-p0-9]{32}['""]", "extId = '$extId'"
        Set-Content -Path $installDest -Value $html -NoNewline
        Write-Host "Install page: $installDest" -ForegroundColor Cyan
    }

    # ── Update firebase-applet-config.json ──
    $configPath = Join-Path $PSScriptRoot "..\firebase-applet-config.json"
    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        $config.extensionId = $extId
        $config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -NoNewline
        Write-Host "Updated firebase-applet-config.json with extensionId" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Distribute:" -ForegroundColor Cyan
    Write-Host "  1. Upload $destCrx + install.html to your web host"
    Write-Host "  2. Users open install.html, click download"
    Write-Host "  3. Drag .crx into chrome://extensions (Developer Mode ON)"
} else {
    Write-Host "Extension ID: (could not auto-extract - check key.pem)" -ForegroundColor Yellow
}
