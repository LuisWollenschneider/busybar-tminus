# T-Minus

An animated countdown to any moment for the [BUSY Bar](https://busy.app). It shows less detail the further away the
moment is, turns amber and then red as it gets close, takes the whole display for the final hour, and counts up in red
once the moment has passed.

![Countdown to Christmas](screenshots/front-1.png)
![Amber, hours and minutes](screenshots/front-2.png)
![Red, the final hour](screenshots/front-3.png)
![Past the moment](screenshots/front-4.png)

What it shows, the controls and the settings are described in [CATALOG.md](CATALOG.md), the text of the app's page in
the BUSY Apps Catalog.

## How it works

| File | What it does |
| --- | --- |
| `src/main.ts` | Lifecycle: reads the settings and the bar's time zone, routes keys to the countdown or the menu, keeps the presets in `localStorage`, and releases everything on Back. One timer wakes only when the screen changes: every second in the final hour and the first hour past zero, else on the minute. |
| `src/store.ts` | The presets: what each counts down to, how each repeat rule finds its next moment, and their compact form in `localStorage`. |
| `src/editor.ts` | The preset menu as a state machine: the list, a preset's actions, the delete question and the editor. |
| `src/menu.ts` | The menu on both displays. |
| `src/countdown.ts` | The arithmetic, free of the device: calendar months, how much detail to show, the urgency state. |
| `src/frame.ts` | Both displays for one moment, as display elements: layout, colours and the once-a-second beat in the red. |
| `src/screen.ts` | Sends only the elements that changed since the last frame, one request at a time. |
| `src/fonts.ts` | Compact text metrics of the bar's fonts, so the value can use the largest font that fits. |

The settings page cannot hold a list, and an app can read its settings but not write them, so the presets are made
and changed on the bar and kept in the app's `localStorage` (up to 20, a few hundred bytes). The settings page has
only the options that apply to all of them.

The bar's JavaScript clock runs in UTC. The app reads the bar's offset from `GET /api/time` at the start and every 30
minutes, so it follows the bar's time zone and summer time. A target on the other side of a summer time change is
still computed with today's offset, so it can be an hour off until the change happens.

## Development

The app was built and tested with [BUSY Bar Emulator](https://github.com/busy-app/busybar-emulator) on firmware 1.4.1.

```sh
npm install
npm test              # unit tests of the countdown logic and the font tables (Node 24+)
npm run typecheck
npm run build         # dist/dev.luiswo.tminus.tgz
npm run app:install   # install it on a BUSY Bar connected over USB
npm run app:run
```

With the emulator: `busy-emulator dev --once` builds, installs and starts it.

This is a port of the Python [Countdown](https://github.com/maxswinkels/busybar-apps/tree/main/apps/countdown) app,
which drove the bar from a computer over its HTTP API. This version runs on the bar itself.
