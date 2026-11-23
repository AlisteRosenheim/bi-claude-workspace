# Icon set: CATMEME_01_HONOR_Cat_Meme_Icon_Pack

Source: 40 individually-exported 512x512 PNGs (no sprite-sheet slicing, no
neighbor bleed), downscaled to 192x192 and masked with the real device's
own `icon_mask.png` (extracted from the reference theme) for correct
rounded-corner transparency, staged flat in `icon-source/`.

An earlier version of this set was sliced by hand from a single sprite
sheet, which left faint neighbor-bleed artifacts on a couple of icons and
used a hand-approximated corner mask instead of the real one — this
version replaces that source entirely.

Package names below were checked against a real, working Honor theme's own
icon pack (extracted from a `.hnt` confirmed installing on a Honor 400 5G),
not guessed from general Android knowledge — that's why this list is much
longer than an earlier pass at this file.

## Applied (`icon-source/`, ready to package — 34 icons)

| File | App | Confidence |
|---|---|---|
| `com.android.settings.png` | Settings | confirmed in reference theme |
| `com.android.stk.png` | SIM Toolkit | confirmed |
| `com.android.phone.png` | Phone | confirmed (no `com.hihonor.*` dialer variant exists in the reference set) |
| `com.android.browser.png` | Browser | confirmed (no `com.hihonor.*` browser variant exists) |
| `com.android.music.png` | Music | confirmed (no `com.hihonor.*` music variant exists) |
| `com.android.gallery3d.png` | Gallery | confirmed |
| `com.android.systemui.flashlight.FlashlightActivity.png` | Torch | confirmed |
| `com.hihonor.contacts.png` | Contacts | confirmed |
| `com.hihonor.calendar.png` | Calendar | confirmed |
| `com.hihonor.calculator.png` | Calculator | confirmed |
| `com.hihonor.compass.png` | Compass | confirmed |
| `com.hihonor.tips.png` | Tips | confirmed |
| `com.hihonor.camera.png` | Camera | confirmed |
| `com.hihonor.photos.png` | Photos/Gallery | confirmed |
| `com.hihonor.email.png` | Email | confirmed |
| `com.hihonor.filemanager.png` | Files | confirmed |
| `com.hihonor.deskclock.png` | Clock | confirmed |
| `com.hihonor.health.png` | Health | confirmed |
| `com.hihonor.notepad.png` | Notes | confirmed |
| `com.hihonor.soundrecorder.png` | Recorder | confirmed |
| `com.hihonor.systemmanager.png` | Phone Manager | confirmed (also covers "Optimizer" — same app, see below) |
| `com.hihonor.appmarket.png` | AppGallery | confirmed |
| `com.hihonor.gamecenter.png` | Game Center | confirmed |
| `com.hihonor.mms.png` | Messages | confirmed |
| `com.hihonor.android.thememanager.png` | Themes | confirmed |
| `com.hihonor.android.totemweather.png` | Weather | confirmed |
| `com.hihonor.android.clone.png` | Phone Clone | confirmed |
| `com.google.android.apps.accessibility.voiceaccess.png` | Voice Access | confirmed |
| `com.google.android.apps.maps.png` | Google Maps | not in reference set, but a stable Google package id — kept |
| `com.google.android.apps.photos.png` | Google Photos | not in reference set (device may use `com.hihonor.photos` instead — both are included, whichever's installed gets themed) |
| `com.google.android.googlequicksearchbox.png` | Google app / Search | not in reference set, kept as a stable Google package id |
| `com.google.android.apps.docs.png` | Google Drive | not in reference set, kept as a stable Google package id |
| `com.google.android.apps.wellbeing.png` | Digital Wellbeing | not in reference set, kept as a stable Google package id |
| `com.google.android.apps.books.png` | Google Play Books | not in reference set, kept as a stable Google package id |

## Still needs your device to confirm (`icon-source/_needs-package-name/`)

The reference theme didn't cover these — either genuinely device/app-
specific, or just not something that theme's author bothered with:

| File | Notes |
|---|---|
| `video.png` | No `com.hihonor.*` video app found in the reference set. Unconfirmed candidates from older Huawei/Xiaomi sources: `com.huawei.hwvplayer`, `com.miui.videoplayer` — neither verified for this device |
| `honor.png` | Unclear what this tile should map to — possibly a duplicate of AppGallery or the Theme Manager app, or Honor's own account/club app (no matching package found) |
| `wallet.png` | No matching package found in the reference set |
| `smart_remote.png` | Only found `com.duokan.phone.remotecontroller` (a Xiaomi-associated class name) in the reference set — unclear if genuinely used on Honor |
| `trip_com.png` | Third-party app, package name varies |
| `cloud.png` | No matching package found in the reference set |
| `optimizer_same_as_phone_manager.png` | Almost certainly the same app as Phone Manager (`com.hihonor.systemmanager`, already applied) — kept separate in case your device exposes it under its own package |

### How to find the real package name on your Honor 400 5G

**Option A — ADB (most reliable):**
```
adb shell pm list packages | findstr /i honor
adb shell pm list packages -f
```
Match the app by its label in Settings > Apps, or open it and run:
```
adb shell dumpsys window | findstr /i mCurrentFocus
```
while the app is in the foreground — it prints the package name.

**Option B — on-device app:** install a package-name viewer (e.g. "Package
Name Viewer" from the Play Store) and look each app up directly.

Once you have the real package name, move the file from
`icon-source/_needs-package-name/` into `icon-source/` (flat, no
subfolder) and rename it to `<package.name>.png`. Only files directly in
`icon-source/` get zipped into the theme's `icons` entry at build time.
