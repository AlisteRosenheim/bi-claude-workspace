# Builds a Tarot Reader "deck pack" (cards + art, no text) from a folder of card images.
# Usage: powershell -File make-deck-pack.ps1 -Folder "C:\path\to\cards" -Out "deck-pack.json"
# File names like "00 - The Fool.png" and "Cups - Ace of Cups.png" are understood.
# Optional -Spreads: a JSON file of spreads ([{name, description, positions:[{label, meaning, x, y, rot}]}]) to include.
param([Parameter(Mandatory)] [string]$Folder, [Parameter(Mandatory)] [string]$Out, [string]$Spreads)
Add-Type -AssemblyName System.Drawing

$suits = [ordered]@{ Wands = 'Dragons'; Cups = 'Cats'; Swords = 'Birds'; Pentacles = 'Dogs' }
$ranks = 'Ace','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Page','Knight','Queen','King'
$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'

function Get-JpegDataUrl([Drawing.Image]$img, [int]$maxSide, [long]$quality) {
    $s = [Math]::Min(1.0, $maxSide / [Math]::Max($img.Width, $img.Height))
    $b = New-Object Drawing.Bitmap ([int]($img.Width * $s)), ([int]($img.Height * $s))
    $g = [Drawing.Graphics]::FromImage($b)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
    $g.DrawImage($img, 0, 0, $b.Width, $b.Height)
    $p = New-Object Drawing.Imaging.EncoderParameters 1
    $p.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), $quality
    $ms = New-Object IO.MemoryStream; $b.Save($ms, $jpeg, $p)
    $g.Dispose(); $b.Dispose()
    'data:image/jpeg;base64,' + [Convert]::ToBase64String($ms.ToArray())
}
function Esc([string]$s) { ($s -replace '\\', '\\' -replace '"', '\"') }

$cards = New-Object Collections.Generic.List[string]
foreach ($f in Get-ChildItem $Folder -File | Where-Object Extension -match '^\.(png|jpe?g|webp)$' | Sort-Object Name) {
    $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)
    $name = if ($base -match ' - ') { $base.Substring($base.LastIndexOf(' - ') + 3) } else { $base }
    $group = ''; $order = $null
    if ($base -match '^(\d{1,2})\s*-') { $group = 'Major Arcana'; $order = [int]$Matches[1] + 1 }
    elseif ($name -match '^(\w+) of (\w+)$' -and $suits.Contains($Matches[2])) {
        $suit = $Matches[2]; $si = [array]::IndexOf(@($suits.Keys), $suit); $ri = [array]::IndexOf($ranks, $Matches[1])
        $group = "$suit ($($suits[$suit]))"; if ($ri -ge 0) { $order = 23 + $si * 14 + $ri }
    }
    $img = [Drawing.Image]::FromFile($f.FullName)
    try { $full = Get-JpegDataUrl $img 1400 88; $thumb = Get-JpegDataUrl $img 360 82 } finally { $img.Dispose() }
    $o = if ($null -ne $order) { $order } else { 'null' }
    $cards.Add("{""name"":""$(Esc $name)"",""group"":""$(Esc $group)"",""order"":$o,""imageFile"":""$(Esc $f.Name)"",""image"":""$full"",""thumb"":""$thumb""}")
    Write-Host ("{0,2}  {1,-22} {2,-20} #{3}" -f $cards.Count, $name, $group, $o)
}
$spreadJson = if ($Spreads) { [IO.File]::ReadAllText($Spreads).Trim().TrimStart([char]0xFEFF) } else { '[]' }
$null = $spreadJson | ConvertFrom-Json   # fail early if the spreads file isn't valid JSON
if (-not $spreadJson.StartsWith('[')) { $spreadJson = "[$spreadJson]" }
$json = '{"app":"tarot-reader","version":1,"kind":"pack","exported":"' + (Get-Date -Format s) + '","cards":[' + ($cards -join ',') + '],"spreads":' + $spreadJson + ',"readings":[]}'
[IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false))
"{0} cards -> {1} ({2:N1} MB)" -f $cards.Count, $Out, ((Get-Item $Out).Length / 1MB)
