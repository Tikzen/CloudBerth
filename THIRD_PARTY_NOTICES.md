# Third-party notices

## cloud-game-shell

CloudBerth derives from [sheepandriy/cloud-game-shell](https://github.com/sheepandriy/cloud-game-shell),
upstream commit `c7dacf0b15aa39432361e9c5a3ac7868baefef00` (version 1.0.0).

The upstream `package.json` declares `"license": "MIT"` and `"author": "CloudGameShell"`.
At that commit, no standalone LICENSE file or explicit copyright notice was supplied.
This records the upstream declaration as supplied; the copyright notice for
CloudBerth contributors does not claim ownership of the upstream contributions.

The original application used upstream icons. The current CloudBerth working tree
contains replacement branding assets at `build/icon.svg`, `build/icon.png`,
`build/icon.ico` and `src/launcher/brand-mark.svg`. These branding updates do not
alter the attribution of the upstream source code.

CloudBerth adds macOS support, separate launcher/game windows, website/custom
avatars, a redesigned launcher, native shortcut recording and profile migration.
It is maintained independently and does not imply endorsement by the upstream author.

## Electron and bundled components

Electron and electron-builder are development dependencies with their own licenses.
Electron distributions include Chromium and other third-party components and their
license files. Retain the license files included with Electron when distributing
the packaged application. Refer to the dependency packages for their notices.

## Website assets

Website favicons and user-selected avatars are runtime user data. They are not
included in this source distribution. Such assets remain subject to their owners'
rights and applicable terms.
