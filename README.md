# Guitar Practice

A browser-based guitar practice app derived from [Steminize](https://github.com/Gerschwin/steminize).

## Privacy

Audio, stems, titles and practice settings stay in this device's browser storage. There is no audio upload, account system, analytics or cloud sync. Model downloads contact Hugging Face; site delivery contacts GitHub. These providers can receive connection metadata such as IP address. External links are user-initiated and do not include song titles. Exported backups are saved to the user's device; sharing them is a separate user action.

This repository contains application code and built assets only. It includes no music, personal library, backups, local development history, screenshots or diagnostics. GitHub Pages publishes only `site/`.

## Use

Import a song or stems, play, loop, adjust BPM and transpose. Each device/browser/site origin has separate storage. To move songs between devices, explicitly export and restore a library ZIP. On iPad, add the HTTPS site to the Home Screen from Safari. Six-stem separation on real iPad hardware is not yet validated.

## Build and licensing

`source/` contains the application source. With Node 22 or later, run `npm ci` and `npm run build` there. Its `dist/` is the publication payload. Preserve LICENSE and LICENCES.md; see dependency sources/licences listed there. Built third-party libraries and model assets retain their respective licences. The public repository is a fresh snapshot, not the private development repository's history.
