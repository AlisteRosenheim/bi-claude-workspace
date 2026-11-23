<#
  Packages this folder into a .hnt theme file, matching the structure
  confirmed against a real, working Honor MagicOS theme:

    description.xml
    preview/cover.jpg
    wallpaper/home_wallpaper_0.jpg, unlock_wallpaper_0.jpg
    unlock/theme.xml
    icons              <- a ZIP file with no extension, built from icon-source/
    com.android.systemui <- a ZIP file with no extension, built from systemui-overlay/

  Uses System.IO.Compression directly (not Compress-Archive) and forces
  forward-slash entry names — Compress-Archive writes backslash separators
  on Windows, which violates the ZIP spec and Android's zip parser expects
  forward slashes like every real theme package uses.

  Usage:
    ./build.ps1 -Name "MyHonorTheme"
#>
param(
    [string]$Name = "MyHonorTheme"
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$dist = Join-Path $root "dist"
$finalHnt = Join-Path $dist "$Name.hnt"

if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
if (Test-Path $finalHnt) { Remove-Item $finalHnt -Force }

function New-ZipBytesFromDirectory {
    param([string]$Dir)
    # Builds a zip in memory from $Dir's contents, entries relative to $Dir,
    # always forward-slash, and returns the raw bytes.
    $ms = New-Object System.IO.MemoryStream
    $archive = New-Object System.IO.Compression.ZipArchive($ms, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    $files = Get-ChildItem -Path $Dir -Recurse -File
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($Dir.Length).TrimStart('\', '/').Replace('\', '/')
        $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fileBytes = [System.IO.File]::ReadAllBytes($f.FullName)
        $entryStream.Write($fileBytes, 0, $fileBytes.Length)
        $entryStream.Close()
    }
    $archive.Dispose()
    return $ms.ToArray()
}

function Add-FileEntry {
    param($Archive, [string]$SourcePath, [string]$EntryName)
    $entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($SourcePath)
    $entryStream.Write($bytes, 0, $bytes.Length)
    $entryStream.Close()
}

# --- build the two nested (extensionless) resource zips in memory ---
$iconBytes = New-ZipBytesFromDirectory (Join-Path $root "icon-source" | Resolve-Path).Path
# strip the _needs-package-name subtree from the in-memory zip by rebuilding
# from a filtered file list instead (simpler: build straight from a filtered temp copy)
$iconTemp = Join-Path $dist "_icon_tmp"
if (Test-Path $iconTemp) { Remove-Item $iconTemp -Recurse -Force }
New-Item -ItemType Directory -Path $iconTemp | Out-Null
Get-ChildItem (Join-Path $root "icon-source") -File | Copy-Item -Destination $iconTemp
$iconBytes = New-ZipBytesFromDirectory (Resolve-Path $iconTemp).Path
Remove-Item $iconTemp -Recurse -Force

$systemuiBytes = New-ZipBytesFromDirectory (Resolve-Path (Join-Path $root "systemui-overlay")).Path

# --- assemble the outer container ---
$ms = New-Object System.IO.MemoryStream
$archive = New-Object System.IO.Compression.ZipArchive($ms, [System.IO.Compression.ZipArchiveMode]::Create, $true)

Add-FileEntry $archive (Join-Path $root "description.xml") "description.xml"
Add-FileEntry $archive (Join-Path $root "preview\cover.jpg") "preview/cover.jpg"
Add-FileEntry $archive (Join-Path $root "wallpaper\home_wallpaper_0.jpg") "wallpaper/home_wallpaper_0.jpg"
Add-FileEntry $archive (Join-Path $root "wallpaper\unlock_wallpaper_0.jpg") "wallpaper/unlock_wallpaper_0.jpg"
Add-FileEntry $archive (Join-Path $root "unlock\theme.xml") "unlock/theme.xml"

$iconsEntry = $archive.CreateEntry("icons", [System.IO.Compression.CompressionLevel]::NoCompression)
$s = $iconsEntry.Open(); $s.Write($iconBytes, 0, $iconBytes.Length); $s.Close()

$suEntry = $archive.CreateEntry("com.android.systemui", [System.IO.Compression.CompressionLevel]::NoCompression)
$s = $suEntry.Open(); $s.Write($systemuiBytes, 0, $systemuiBytes.Length); $s.Close()

$archive.Dispose()
[System.IO.File]::WriteAllBytes($finalHnt, $ms.ToArray())
$ms.Dispose()

Write-Output "Built: dist/$Name.hnt"
