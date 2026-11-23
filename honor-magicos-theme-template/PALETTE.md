# Accent palette

Colors extracted directly from the theme's own assets (pixel-sampled, not
guessed), so the accent ties the wallpaper and icon set together instead of
being an arbitrary choice.

| Swatch | Hex | Source |
|---|---|---|
| 🟥 Accent Red | `#E62018` | Sampled from the icon set's recurring reds (calendar banner, health heart, maps pin, recorder dot — all cluster in the same hue, ~0-6°) |
| 🟤 Deep Red | `#5B120C` | Sampled directly from the wallpaper's chest-logo flame decal (same hue family as the icon reds, just under low-key backlight) |
| 🟨 Gold | `#F2C44D` | Sampled from the icon set's Tips lightbulb — secondary accent |
| ⬛ Ink Black | `#0B0D12` | Shared dark neutral — matches both the wallpaper's black backdrop and the icon sheet's card background |
| ⬜ White | `#FFFFFF` | Icon label text / high-contrast foreground, already used throughout the icon set |

**Why red:** it's not a stylistic pick — the wallpaper's chest-logo flame
graphic and several of the icon set's recurring highlights (calendar,
health, maps, recorder) land in the same narrow red hue independently of
each other. That's what makes it the natural accent rather than an
arbitrary color choice.

## Where this is applied

This actually reaches the system now — a real extracted theme showed that
Honor/MagicOS accent tinting lives in a plain, hand-editable
`com.android.systemui/theme.xml` (not a compiled resource overlay like
earlier versions of this template assumed):

- [`systemui-overlay/theme.xml`](systemui-overlay/theme.xml) and
  [`systemui-overlay/night/theme.xml`](systemui-overlay/night/theme.xml) —
  `magic_accent` (Control Center toggle color) and
  `hnnotification_brightness_slider_color` (volume/brightness slider fill)
  are set to Accent Red; panel backgrounds use Ink Black; icons and text
  use White. These get zipped into the theme's `com.android.systemui`
  entry by `build.ps1`.
- Reference for any new art added later — e.g. if you design icons for the
  apps still in `icon-source/_needs-package-name/` (see
  [`ICON_MAPPING.md`](ICON_MAPPING.md)), using this palette keeps them
  visually consistent with the rest of the set.

## What's still not covered

`systemui-overlay/theme.xml` only sets the color keys listed in
`PALETTE.md`'s "applied" section above — the file has a comment block
listing other real keys (seen in a working reference theme) you can add if
you want to push the accent further: `magic_progress`,
`magic_subtab_text_on`, `magic_bottombar_icon_on`, and others. Deeper
per-app UI changes (actual layout/drawable changes to Settings, Dialer,
etc., beyond named color swaps) are still out of scope — those require
resource work specific to the exact app version, not just color values.
