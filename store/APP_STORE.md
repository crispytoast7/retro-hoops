# Retro Hoops on the App Store

Everything needed to fill in App Store Connect. The app itself is ready: iPhone only, portrait,
offline, no data collected, launch screen and icon set, encryption flag set.

## 1. Before you start

- Join the **Apple Developer Program** ($99/year) with your Apple ID: developer.apple.com/programs.
  The free account can only install the app on your own phone.
- In **App Store Connect** (appstoreconnect.apple.com): Apps → "+" → New App.
  - Platform: iOS
  - Name: see below
  - Primary language: English (U.S.)
  - Bundle ID: `app.retrohoops.game` (register it under Certificates, IDs & Profiles → Identifiers if it is not offered)
  - SKU: `retrohoops1`

## 2. Listing

| Field | Text |
|---|---|
| Name (30 max) | **Retro Hoops: Coach & GM** (fallback if taken: *Retro Hoops Franchise*) |
| Subtitle (30 max) | Basketball GM & arcade hoops |
| Primary category | Games → Sports |
| Secondary category | Games → Simulation |
| Price | Free |
| Age rating | 4+ (answer "None" to every content question) |
| Privacy policy URL | https://crispytoast7.github.io/retro-hoops/privacy.html |
| Support URL | https://github.com/crispytoast7/retro-hoops |
| Marketing URL (optional) | https://crispytoast7.github.io/retro-hoops/ |
| Copyright | 2026 *your name* |

**Keywords** (100 max, comma separated, no spaces):

```
basketball,gm,manager,coach,retro,pixel,arcade,sports,franchise,draft,dunk,offline,8-bit,hoops,sim
```

**Promotional text** (170 max, can be changed any time):

> Take the worst team in the league to a title. Hold SHOOT, let go on the rim, and watch the slam cam.

**Description**:

> You've been handed the worst team in the league. Build it into a champion.
>
> RETRO HOOPS is a pixel-art basketball game in two halves: you run the club, and you play the big possessions yourself.
>
> ON THE COURT
> • Play about a dozen key moments a game: fast breaks, pick-and-rolls, post-ups, the last shot
> • Hold SHOOT and let go when the crosshair is on the rim. Pump fake, cross him up, throw the lob
> • Putbacks, alley-oops and the slam cam: reverse jams, windmills, 360s
> • Score in your moments and your team goes on a run. Miss, and they do
>
> IN THE FRONT OFFICE
> • One move every week: train a player, prepare for the next opponent, or look after the club
> • Trades, free agency, a two-round draft with a lottery, contracts and a salary cap
> • Six facilities to build, from a brick gym to a lit-up dome, shown in a picture of your club that grows
> • Big moments: a star wants a new deal, a rookie breaks out, a rival comes for your coordinator
> • Rivalries, player form, awards night, Player of the Week, and reporters arguing about the greatest of all time
>
> PLAY YOUR WAY
> • Plays fully offline. No account, no ads, no data collected
> • An Assistant GM can handle the chores for you
> • The court adapts: struggle and it eases off, dominate and the league comes for you

**What's New** (version 1.0): leave empty for the first release.

## 3. Screenshots

Upload the five files in `store/screenshots/` (1320 × 2868, the 6.9-inch iPhone size). App Store
Connect scales them for smaller iPhones. They were captured from the game in a browser at iPhone
size, so they look exactly like the app.

## 4. App Privacy

App Store Connect → App Privacy → "Data Not Collected". Nothing else to fill in.

## 5. Build and upload

1. Open the project: `npm run ios:open` (runs a fresh build and opens Xcode).
2. In Xcode, select the **App** target → Signing & Capabilities → choose your paid team.
3. Top bar: set the destination to **Any iOS Device (arm64)**.
4. Product → **Archive**. When it finishes, the Organizer opens: **Distribute App** → App Store Connect → Upload.
5. Wait for the build to finish processing (an email arrives), then pick it in App Store Connect under the version.
6. Optional but wise: add yourself as a TestFlight tester and play it once from TestFlight.

For later updates, raise the version in Xcode (General → Version, e.g. 1.0.1) and the Build number every upload.

## 6. Notes for the reviewer (App Review Information → Notes)

> Retro Hoops is a single-player basketball game that runs entirely on the device: no login, no
> server, no network needed. To try it: New Game → Start my career → Take the job → Play. Settings →
> Practice the controls teaches the on-court controls in seven short drills. Hold the SHOOT button
> (bottom right) and release when the crosshair is over the rim.

No demo account is needed (leave "Sign-in required" unchecked).

## 7. Things that commonly get games rejected, already handled

- Minimum functionality (4.2): the whole game is bundled and runs offline; it is not a website wrapper.
- Broken features (2.1): Export save uses the iPhone share sheet; the web-only "Add to Home Screen" panel is hidden in the app.
- Placeholder content (2.3): app icon and launch screen are Retro Hoops art, not template images.
- iPad: the app is iPhone-only, so no iPad screenshots are needed.
- Privacy (5.1): policy linked in the listing and in Settings; no data collected.
- Encryption export compliance: `ITSAppUsesNonExemptEncryption` is set to NO, so no questionnaire.
- Originality (4.1): all team, player and city names and all art and music are original. Do not
  mention other games by name in the listing.
