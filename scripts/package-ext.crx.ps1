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

# ── Extract extension ID from CRX ──
# CRX v3 format: magic(4) + version(4) + header_size(4) + header(header_size)
# In header: public key length is at a fixed offset; ID = SHA256(pubkey)[:16] hex → a-p alphabet
$crxBytes = [System.IO.File]::ReadAllBytes($destCrx)
$extId = ""

if ($crxBytes.Length -ge 12) {
    $magic = [BitConverter]::ToUInt32($crxBytes, 0)
    $version = [BitConverter]::ToUInt32($crxBytes, 4)
    $headerSize = [BitConverter]::ToUInt32($crxBytes, 8)

    if ($version -eq 3 -and $crxBytes.Length -ge 12 + $headerSize) {
        # ── Method 1: Try extracting from key.pem (primary) ──
        if (Test-Path $keyPath) {
            try {
                $pemContent = Get-Content $keyPath -Raw
                $base64Key = ($pemContent -replace "-----.*-----", "" -replace "\s", "")
                $keyBytes = [Convert]::FromBase64String($base64Key)

                # .NET Framework 4.8: import RSA from PKCS#8 private key,
                # then export public key in SPKI DER format, then SHA256 hash it.
                # This is the correct Chrome extension ID algorithm.
                $rsa = [System.Security.Cryptography.RSA]::Create()
                $rsa.ImportPkcs8PrivateKey($keyBytes, [ref]$null) | out-null
                $pubKeyDer = $rsa.ExportSubjectPublicKeyInfo()
                $sha = [System.Security.Cryptography.SHA256]::Create()
                $hash = $sha.ComputeHash($pubKeyDer)
                # First 16 bytes → hex string
                $hexChars = @()
                for ($i = 0; $i -lt 16; $i++) {
                    $hexChars += $hash[$i].ToString("x2")
                }
                $hexStr = ($hexChars -join "")
                # Chrome maps hex char 0-9a-f → a-p
                $alpha = 'abcdefghijklmnop'
                $extIdChars = @()
                for ($i = 0; $i -lt $hexStr.Length; $i++) {
                    $c = $hexStr[$i]
                    $val = [int]::Parse($c, 'HexNumber')
                    $extIdChars += $alpha[$val]
                }
                $extId = ($extIdChars -join "")
            } catch {
                # Fallback to old method if RSA import fails
                $pemContent = Get-Content $keyPath -Raw
                $base64Key = ($pemContent -replace "-----.*-----", "" -replace "\s", "")
                $keyBytes = [Convert]::FromBase64String($base64Key)
                $sha = [System.Security.Cryptography.SHA256]::Create()
                $hash = $sha.ComputeHash($keyBytes)
                $extId = ($hash[0..15] | ForEach-Object { $_.ToString("x2") }) -join ""
            }
        }
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
