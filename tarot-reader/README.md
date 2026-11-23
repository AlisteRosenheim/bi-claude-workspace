# Tarot Reader

A personal, fully offline tarot app. You load it with your own deck's art, the card
descriptions and meanings, and your spreads. Then you photograph a laid-out reading and it
recognizes the cards and the spread and explains each position. Nothing leaves the device.

## Folders

- `www/` holds the app itself (plain HTML/CSS/JS, no internet or libraries needed). This is what gets packaged for Android or iOS.
  - `js/vision.js` finds cards in a photo, recognizes them against your art (including reversed cards), and matches the layout to a spread.
  - `js/data.js` handles the on-device database (IndexedDB) and CSV/JSON import.
  - `js/app.js` contains the screens: Read, Cards, Spreads, Journal, Setup.
- `tools/serve.py` is a local test server: `python tools/serve.py`, then open http://localhost:8765
- `tests/synth.js` is a recognition test that uses a generated fake deck and fake spread photos.

## Not in this repository

- **Signing key** (`android/tarot-release.jks`, `android/keystore.properties`): kept private. Builds need
  your own key; see `android/app/build.gradle` for the expected `keystore.properties` fields.
- **Deck art and guidebook text** (the starter pack, card meanings and the 4 guidebook spreads) are the
  publisher's copyrighted material and are kept locally only. Build your own pack with
  `tools/make-deck-pack.ps1` from photos of your deck.
- `releases/TarotReader-1.4.apk` is a ready-to-install build of the app (with no cards or meanings in it).

## Android app

- `TarotReader-1.0.apk` is the installable app. It has no internet permission.
- `android/` contains the native shell (a WebView hosting `www/`, plus camera, file pickers, saving files and the back button).
- `build-apk.cmd` rebuilds the APK after changes. Raise `versionCode` in `android/app/build.gradle` first.
- **Keep `android/tarot-release.jks` and `android/keystore.properties` safe and private.** Updates must be
  signed with this same key, or Android will refuse to install them over the existing app (and
  uninstalling first would erase the app's data, unless you have a backup).
- Build tools are installed in `C:\Users\SCMPH340\AndroidDev` (JDK 17, Gradle 8.11.1, Android SDK 35).

## Getting your data in (Setup tab)

1. **Card art:** pick all your card images at once. File names are matched to card names
   (`00-the-fool.jpg`, `The Fool.png` and `01_the_fool.webp` all match "The Fool").
2. **Descriptions & meanings:** CSV or JSON. Only `name` is required. Recognized columns:
   `name, description, upright, reversed, keywords, source, suit/arcana, image`.
   Import descriptions and meanings from separate files if you like; empty cells never erase text.
3. **Spreads:** in the Spreads tab, choose **Spread template picture** to read a spread from a
   diagram (book page, screenshot, or photo of one). On-device OCR (Tesseract, in
   `www/vendor/tesseract`, Apache-2.0) reads the boxes, numbers, title, position names and
   meanings. If the title matches a saved spread, that spread is updated. You can also
   build spreads by hand (drag the layout, or start from a photo of laid-out cards),
   or import a CSV with one row per position: `spread, position, label, meaning, x, y, sideways`
   (`x`/`y` are measured in card heights).

**Packs:** `tools/make-deck-pack.ps1 -Folder <card images> -Out <file>.json [-Spreads <spreads.json>]`
builds a pack file (card art plus optional spreads). Import it with **Restore backup / add deck pack**:
it adds to what's there instead of replacing it. `Arcanis-Animal-Tarot-starter-pack.json` holds the 78
Arcanis cards and the 4 spreads from the guidebook (`arcanis-spreads.json`).

Use **Backup** to save everything (art, text, spreads, journal) to a single file.

## Recognition tips

Shoot from straight above, fill the frame with the spread, use a surface that contrasts
with the card edges, leave small gaps between cards, and avoid glare. Boxes on the photo are
green (sure), amber (fairly sure) or red (check). Tap any box to correct the card or flip it.
