<#
  build-scores.ps1 -- Batch-export scores and audio with MuseScore.

  WHY THIS FILE IS PURE ASCII:
    Windows PowerShell 5.1 reads .ps1 files using the system ANSI codepage
    unless they carry a UTF-8 BOM, so non-ASCII text inside a script is a
    reliable source of parse errors on Chinese Windows. All user-facing
    Chinese documentation lives in README-使用说明.md instead.

  WHAT IT DOES:
    1. Scans scores\ for .mscz / .mscx / .musicxml / .mxl / .mid
    2. Exports each to assets\scores\<name>.svg   (vector, 8px trimmed)
    3. Exports each to assets\scores\<name>.mp3   (audio for the web page)

  NOTE: it used to also bundle every SVG into assets\scores\scores.js, so the
  page would render scores under file:// too. That bundle cost ~981 KB on every
  page load while duplicating the loose .svg files, and http(s) fetches the .svg
  directly anyway -- so it was removed. Opening index.html from disk now shows a
  short note in the score area instead; run a local static server to see scores.

  USAGE:
    powershell -ExecutionPolicy Bypass -File tools\build-scores.ps1
    powershell -ExecutionPolicy Bypass -File tools\build-scores.ps1 -Only b1
    powershell -ExecutionPolicy Bypass -File tools\build-scores.ps1 -NoAudio
    powershell -ExecutionPolicy Bypass -File tools\build-scores.ps1 -Bitrate 96
#>
[CmdletBinding()]
param(
  [string]$Only = '',
  [switch]$NoAudio,
  [int]$Bitrate = 128
)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root 'scores'
$outDir = Join-Path $root 'assets\scores'

$msCandidates = @(
  'C:\Program Files\MuseScore 4\bin\MuseScore4.exe',
  'C:\Program Files (x86)\MuseScore 4\bin\MuseScore4.exe',
  'C:\Program Files\MuseScore 3\bin\MuseScore3.exe',
  'C:\Program Files\MuseScore 3\bin\MuseScore3.exe'
)
$ms = $msCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ms) {
  throw 'MuseScore not found. Edit the msCandidates list at the top of this script.'
}

Write-Host "MuseScore : $ms"            -ForegroundColor DarkGray
Write-Host "Source    : $srcDir"
Write-Host "Output    : $outDir"
Write-Host ""

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (-not (Test-Path $srcDir)) {
  New-Item -ItemType Directory -Force -Path $srcDir | Out-Null
  Write-Host 'Created scores\. Put your MuseScore files there and run again.' -ForegroundColor Yellow
  exit 0
}

$files = Get-ChildItem -Path $srcDir -File |
  Where-Object { $_.Extension -in '.mscz', '.mscx', '.musicxml', '.xml', '.mxl', '.mid' }
if ($Only) { $files = $files | Where-Object { $_.Name -like "*$Only*" } }
if (-not $files) {
  Write-Host 'No score files found in scores\.' -ForegroundColor Yellow
  exit 0
}

function Invoke-MuseScore {
  param([string]$Label, [string[]]$ArgList)
  $p = Start-Process -FilePath $ms -ArgumentList $ArgList -NoNewWindow -PassThru -Wait
  if ($p.ExitCode -ne 0) {
    Write-Host "  [$Label] exit code $($p.ExitCode)" -ForegroundColor Red
  }
  return $p.ExitCode
}

$okSvg = 0
$okMp3 = 0
$fail  = 0

foreach ($f in $files) {
  $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)

  # Remove previous output so stale page numbers do not accumulate.
  # The MP3 is only removed when it is going to be regenerated -- otherwise
  # running with -NoAudio would silently delete existing audio.
  $stale = @(Get-ChildItem -Path $outDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "$base-*.svg" -or $_.Name -eq "$base.svg" })
  if (-not $NoAudio) {
    $stale += @(Get-ChildItem -Path $outDir -File -Filter "$base.mp3" -ErrorAction SilentlyContinue)
  }
  foreach ($old in $stale) { Remove-Item $old.FullName -Force -ErrorAction SilentlyContinue }

  Write-Host "> $($f.Name)"

  # --- SVG (vector). -T 8 trims 8px of whitespace around the page.
  $svgOut = Join-Path $outDir "$base.svg"
  Invoke-MuseScore 'svg' @($f.FullName, '-o', $svgOut, '-T', '8') | Out-Null
  $made = @(Get-ChildItem -Path $outDir -Filter "$base-*.svg" -File -ErrorAction SilentlyContinue)
  if ($made.Count -gt 0) {
    if ($made.Count -eq 1) {
      Move-Item $made[0].FullName $svgOut -Force
      $made = @(Get-Item $svgOut)
    }
    Write-Host "  OK  SVG  $($made.Count) page(s)" -ForegroundColor Green
    $okSvg++
  } else {
    Write-Host "  FAIL SVG not produced" -ForegroundColor Red
    $fail++
  }

  # --- MP3 (audio for the web page).
  if (-not $NoAudio) {
    $mp3Out = Join-Path $outDir "$base.mp3"
    Invoke-MuseScore 'mp3' @($f.FullName, '-o', $mp3Out, '-b', "$Bitrate") | Out-Null
    if (Test-Path $mp3Out) {
      $kb = [math]::Round((Get-Item $mp3Out).Length / 1KB)
      Write-Host "  OK  MP3  $kb KB" -ForegroundColor Green
      $okMp3++
    } else {
      Write-Host "  FAIL MP3 not produced" -ForegroundColor Red
      $fail++
    }
  }
}

Write-Host ""
Write-Host "Done. SVG: $okSvg   MP3: $okMp3   Failed: $fail" -ForegroundColor Cyan

if ($fail -eq 0) { Write-Host 'Refresh the page to see the new scores.' -ForegroundColor Cyan }
