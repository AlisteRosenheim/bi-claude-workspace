# Honor MagicOS Theme Template

A scaffold for building a `.hnt` theme for Honor phones (MagicOS).

## This structure is confirmed against a real, working theme

Earlier versions of this template were reconstructed from old EMUI-era
community docs (XDA, EMUI theme blogs) and got several things wrong — wrong
manifest schema, wrong icon folder layout, wrong install path. The current
structure was corrected by extracting a real `.hnt` theme that installs and
applies successfully on a Honor 400 5G (MagicOS 10), so treat this version
as verified, not guessed. If you extract another real theme later and it
differs, trust that one over this file.

**How it's packaged:** a `.hnt` file is a ZIP archive (extension renamed,
same as the older `.hwt`). Two of its top-level entries — `icons` and
`com.android.systemui` — are themselves ZIP files with no file extension,
nested inside the outer one. `build.ps1` assembles both layers.

## Accent palette

See [`PALETTE.md`](PALETTE.md) — accent colors pixel-sampled from the
wallpaper and icon set (not guessed), wired into the real control-center/
notification-shade color keys in `systemui-overlay/theme.xml`.

## Folder layout

```
honor-magicos-theme-template/
├── description.xml        theme manifest (title, designer, version, blurb)
├── preview/
│   └── cover.jpg           shown in the Themes app theme picker (1060x2376)
├── wallpaper/
│   ├── home_wallpaper_0.jpg    home screen wallpaper (2376x2376 square —
│   └── unlock_wallpaper_0.jpg  lock screen wallpaper  see note below)
├── unlock/
│   └── theme.xml           points to unlock_wallpaper_0.jpg, sets lock style
├── icon-source/             flat staging folder -> zipped into the "icons"
│   ├── com.android.settings.png    entry (per-app icon, named by package)
│   ├── com.hihonor.contacts.png
│   ├── ... (34 confirmed apps total, see ICON_MAPPING.md)
│   └── _needs-package-name/   7 more icons staged under a descriptive name
│                               until you confirm the real package on-device
│                               (excluded from the build until moved out)
├── systemui-overlay/        zipped into the "com.android.systemui" entry —
│   ├── theme.xml            accent/notification/volume colors (light)
│   └── night/theme.xml      same, dark-mode override
├── ICON_MAPPING.md
├── PALETTE.md
├── build.ps1                assembles both zip layers into dist/*.hnt
└── dist/                    build output
```

**Why the wallpaper is a square 2376x2376, not the phone's exact
1264x2736 panel resolution:** that's what the real reference theme
shipped — a big square master image, not a device-exact crop. The theme
engine evidently does its own responsive crop/pan from that square source,
so shipping a square (rather than a pixel-perfect match to one specific
phone panel) is the more portable, verified approach.

## Customizing

1. **`description.xml`** — `<title>`, `<designer>`, `<briefInfo>` are
   free text. Leave `<screen>` as `WQHD` (a resolution-class keyword, not
   literal pixels) and `<extra>` as-is unless you have evidence otherwise.
2. **`wallpaper/`** — replace both JPGs with your artwork, square, at least
   ~2376x2376. `unlock/theme.xml`'s `wallpaper="unlock_wallpaper_0.jpg"`
   must match whatever filename you use there.
3. **`icon-source/`** — add one PNG per app you want to re-skin, named
   exactly as the app's Android package name (e.g. `com.tencent.mm.png`
   for WeChat), flat in this folder — no subfolder. 192x192 is a safe size.
   Only apps you provide an icon for are themed. See
   [`ICON_MAPPING.md`](ICON_MAPPING.md) for the current set and how to look
   up a package name you don't have yet.
4. **`systemui-overlay/theme.xml`** (and `night/theme.xml`) — the actual
   accent-color mechanism: plain `<color name="...">#AARRGGBB</color>`
   entries. See [`PALETTE.md`](PALETTE.md) for what's already wired in and
   the comment block in the file itself for other keys you can add.
5. **`unlock/theme.xml`** — `style="magazine"` is carried over unchanged
   from the confirmed-working reference theme; only the wallpaper filename
   is template-specific.

## Building

```powershell
./build.ps1 -Name "MyHonorTheme"
```

This assembles `icon-source/` (minus `_needs-package-name/`) into the
`icons` entry, `systemui-overlay/` into the `com.android.systemui` entry,
and packages everything into `dist/MyHonorTheme.hnt`.

The script uses `System.IO.Compression` directly rather than PowerShell's
`Compress-Archive` — that cmdlet writes backslash (`\`) path separators
into zip entries on Windows, which breaks Android's zip parser (it expects
forward slashes, like every real theme package uses). Worth knowing if you
ever hand-roll the zip step yourself.

## Installing on a device

Copy the `.hnt` file into the Themes app's local-import folder — this
varies by device/launcher setup, so if one location doesn't work, try the
other:

- The general `Downloads` folder, if your phone's Themes app is configured
  to watch it directly (confirmed working on a Honor 400 5G / MagicOS 10
  test device).
- `Android/data/com.hihonor.android.thememanager/files/Download/Honor/Themes/paste`
  (documented for MagicOS 3-6 / older EMUI; may need a file manager with
  "all files access" or ADB to reach `Android/data` on newer Android
  versions).

Then reopen the Themes app (or kill and relaunch it) and check its local/
my-themes tab, or go to Settings > Home screen & Wallpaper > Themes > More
Themes.

## Sources

- Structure and `description.xml`/`theme.xml` schemas: extracted directly
  from a real, working `.hnt` theme ("Pink One UI 7 OS 9" by maddada,
  confirmed installing on a Honor 400 5G, MagicOS 10).
- [How to manually install a EMUI & Magic UI Theme (emuitheme.com)](https://www.emuitheme.com/tutorial/how-to-manually-install-a-emui-and-magic-ui-theme/)
- [Step-by-Step Guide: manually installing EMUI/Magic UI themes (emuihuaweitheme.com)](https://www.emuihuaweitheme.com/2023/05/step-by-step-guide-emui-magic-ui-themes.html)
- [Custom theme installation troubleshooting (XDA Developers forum)](https://xdaforums.com/t/custom-theme.4472175/)
