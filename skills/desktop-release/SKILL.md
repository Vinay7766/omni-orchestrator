---
name: desktop-release
description: Use when packaging, code signing, notarizing or shipping a desktop app (Windows, macOS, Linux) or setting up its auto-updates, whatever the framework (Tauri, Electron, native or anything else). Covers choosing installer formats, getting and protecting signing identities, signing with a secure timestamp, Apple notarization and stapling, signed update feeds, and the evidence a release needs. Use it before the first public build, when users see "unknown publisher" or "app can't be opened" warnings, or when a release pipeline needs signing secrets.
---

# Desktop Release

Shipping a desktop app means three promises to the person installing it: the
file came from you, nobody changed it on the way, and future updates come from
you too. Operating systems check the first two through code signing (and on
macOS, notarization); your updater has to check the third itself. This skill
walks a release through those promises in order and keeps the secrets that
back them out of the repository.

Framework names below (Tauri, Electron) are examples. The steps are the same
for any desktop stack: find where your tool exposes each step and use it.

## Before you start: decisions that belong to the person

Ask, don't assume. Each of these costs money, needs a legal identity, or
cannot be undone cheaply:

1. **Which operating systems ship, and through which channel** (direct
   download, Microsoft Store, Mac App Store, Linux repositories). Store builds
   follow the store's own signing rules.
2. **Who owns the signing identity.** Certificates and developer accounts are
   issued to a person or an organisation after identity checks. The person
   enrols; you never create accounts or buy certificates for them.
3. **Budget.** An Apple Developer account costs $99 per year and a free account
   cannot notarize
   ([Tauri: macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
   Windows certificates and managed signing services are paid as well.

Record the answers (an ADR is a good place) before configuring anything.

## Step 1: Choose the formats per operating system

| OS | Common formats | Notes |
|----|----------------|-------|
| Windows | MSI, NSIS setup `.exe`, Microsoft Store | Tauri produces MSI and NSIS installers ([Tauri updater](https://v2.tauri.app/plugin/updater/)) |
| macOS | `.app` bundle, DMG, Mac App Store | "Both methods requires code signing, and distributing outside the App Store also requires notarization" ([Tauri: distribute](https://v2.tauri.app/distribute/)) |
| Linux | Debian package, RPM, AppImage, Flatpak, Snap, AUR | Listed by [Tauri: distribute](https://v2.tauri.app/distribute/) |

Pick the smallest set your users need. Every extra format is another thing to
sign, test and update.

## Step 2: Keep signing secrets out of the code

Every secret below (certificate files and passwords, Apple account or API
credentials, cloud signing credentials, the updater's private key) lives in
the CI system's secret store or the person's own keychain. Never in the
repository, never in a `.env` file that could be committed, never in logs.

- Pass them to the build as environment variables. Tauri, for example, reads
  `APPLE_CERTIFICATE` (base64 `.p12`) and `APPLE_CERTIFICATE_PASSWORD`
  ([Tauri: macOS signing](https://v2.tauri.app/distribute/sign/macos/)), and
  the updater key from `TAURI_SIGNING_PRIVATE_KEY`, noting that "`.env` files
  do _not_ work!" ([Tauri updater](https://v2.tauri.app/plugin/updater/)).
- Only the release job gets them. Pull request builds from forks should build
  unsigned.
- If a private key or certificate ever reaches a repository or a log, treat
  it as compromised: revoke or rotate it first, then clean up.

## Step 3: Sign on Windows

Unsigned apps are blocked more and more: Smart App Control "blocks unknown
unsigned apps even if they weren't downloaded from the browser"
([Tauri: Windows signing](https://v2.tauri.app/distribute/sign/windows/)).

**Where the certificate comes from** (ask the person, see above):

- A code-signing certificate from a certificate authority. Electron's docs say
  that "since June 2023, Microsoft requires software to be signed with an
  'extended validation' certificate", stored on hardware compliant with
  FIPS 140 Level 2 ([Electron: code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
- Microsoft's managed service, **Artifact Signing** (previously Trusted
  Signing / Azure Code Signing), "a Microsoft fully managed, end-to-end
  signing solution" ([overview](https://learn.microsoft.com/en-us/azure/artifact-signing/overview)).
  Availability is limited: public-trust certificates go to organisations in a
  listed set of countries, and individual developers must be in the United
  States or Canada; organisation validation takes 1 to 20 business days
  ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)).

**Reputation is not instant.** "Since 2024, an EV Certificate no longer gives
your app an immediate reputation with Microsoft SmartScreen"
([Tauri: Windows signing](https://v2.tauri.app/distribute/sign/windows/)).
Electron's page says Artifact Signing "gets rid of SmartScreen warnings"
([Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
The two pages differ in emphasis; tell the person that early downloads may
still show a warning.

**Sign with a digest and a timestamp.** With SignTool:

```
signtool sign /f MyCert.pfx /fd SHA256 /tr <timestamp-url> /td SHA256 MyFile.exe
signtool verify /pa MyFile.exe
```

`/fd` (file digest) is required and SHA256 is recommended; `/tr` with `/td`
requests an RFC 3161 timestamp; `/t` is the legacy form and cannot be combined
with `/tr` ([SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)).
The timestamp records when the file was signed
([Tauri: Windows signing](https://v2.tauri.app/distribute/sign/windows/)), so
do not skip it. Use the timestamp URL your certificate issuer or signing
service documents. Verify with `/pa`: without it "SignTool uses the Windows
Driver Verification Policy" instead of the Default Authentication
Verification Policy; `/tw` warns when a signature has no timestamp
([SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)).

Framework hooks, as examples: Tauri reads `certificateThumbprint`,
`digestAlgorithm` and `timestampUrl` under `bundle > windows`, or runs a
custom `signCommand`, which is required when building Windows installers on
Linux or macOS ([Tauri](https://v2.tauri.app/distribute/sign/windows/)).
Electron uses `@electron/windows-sign`, with Electron Forge as the recommended
route ([Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing)).

## Step 4: Sign and notarize on macOS

Apple's requirements before notarizing
([Apple: notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)):

- sign every executable you distribute with a **Developer ID** certificate
  (not Mac Distribution, ad hoc, Apple Development or local development);
- enable the **Hardened Runtime**;
- include a **secure timestamp** in the signature;
- do not ship the `com.apple.security.get-task-allow` entitlement set to true;
- link against the macOS 10.9 SDK or later.

Then submit, wait, and staple
([Apple: customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)):

```
xcrun notarytool store-credentials "<profile>" --apple-id <id> --team-id <team> --password <app-specific-password>
xcrun notarytool submit MyApp.zip --keychain-profile "<profile>" --wait
xcrun notarytool log <submission-id> --keychain-profile "<profile>" developer_log.json
xcrun stapler staple "MyApp.app"
```

- "The notary service accepts disk images (UDIF format), signed flat
  installer packages, and ZIP archives"; "you can't upload the .app bundle
  directly". Staple the app, disk image or installer package; a ZIP "can't
  [be stapled] directly", so after notarizing a ZIP, staple the app inside it.
- `altool` no longer works: the notary service stopped accepting it on
  1 November 2023.
- When notarization fails, read the log before changing anything.

Framework hooks, as examples: Tauri takes `signingIdentity` (or
`APPLE_SIGNING_IDENTITY`) and notarizes with either `APPLE_API_ISSUER`,
`APPLE_API_KEY`, `APPLE_API_KEY_PATH` or `APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID`. Ad-hoc signing (`"-"`) "does not prevent MacOS from
requiring users to whitelist the installation"
([Tauri: macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
Electron uses `@electron/osx-sign` and `@electron/notarize`, and notes that
Squirrel.Mac auto-updates do not work at all for unsigned apps
([Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing)).

## Step 5: Linux

"Artifact signing is not required for your application to be deployed on
Linux" ([Tauri: Linux signing](https://v2.tauri.app/distribute/sign/linux/)).
AppImages can carry a GPG signature, but "AppImage does not validate the
signature, so you can't rely on it to check whether the file has been
tampered with". Publish checksums over HTTPS and, where your users install
from a repository, follow that repository's signing rules.

## Step 6: Signed updates

An auto-updater downloads and runs code, so it is the most valuable thing to
attack. Require both:

- **A signature check on every update**, with the public key built into the
  app and the private key only in the release job's secrets. Tauri's updater
  "needs a signature to verify that the update is from a trusted source. This
  cannot be disabled"; generate the pair with `tauri signer generate`, put the
  public key (the key itself, not a file path) in `plugins > updater > pubkey`
  ([Tauri updater](https://v2.tauri.app/plugin/updater/)).
- **HTTPS for the update feed.** Tauri enforces TLS in production; its
  `dangerousInsecureTransportProtocol` opt-out is for local testing only.

Losing the updater's private key means existing installs can never accept
another update, so back it up in the person's password manager or secret
store, not only in CI.

## Step 7: Verify and record the release

Before calling a release done, collect evidence on clean machines (or clean
virtual machines) that never had a developer build:

- [ ] Each installer's signature verifies (for example `signtool verify /pa`
      on Windows; the macOS notarization log says "Accepted" and the
      notarization ticket is stapled).
- [ ] Each installer installs and the app starts without a security prompt
      you did not expect (note any SmartScreen warning honestly).
- [ ] The previous release updates to this one through the real update feed.
- [ ] Checksums are published next to the downloads.
- [ ] No secret appears in the build logs.
- [ ] The rollback is written down: how to pull the release from the update
      feed and which previous version users go back to.

Record the commands run and their results with the release, not just "signed".

## What this skill does not cover

- Store submissions (Microsoft Store, Mac App Store): follow the store's own
  process. App Store Connect work is covered by the `asc-release-flow` and
  `asc-submission-health` skills.
- Mobile apps (`android-cli`, `swiftui-expert-skill`).
- The exact verification commands for macOS beyond the notarization log and
  stapling: Apple's notarization pages above do not list one, so check
  Apple's current documentation before relying on `spctl` or `codesign`
  output.

## Sources

Checked on 2026-11-02: Tauri v2 [distribute](https://v2.tauri.app/distribute/),
[Windows](https://v2.tauri.app/distribute/sign/windows/),
[macOS](https://v2.tauri.app/distribute/sign/macos/) and
[Linux](https://v2.tauri.app/distribute/sign/linux/) signing,
[updater](https://v2.tauri.app/plugin/updater/); Apple
[notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
and [customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow);
Microsoft [SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool),
[Artifact Signing overview](https://learn.microsoft.com/en-us/azure/artifact-signing/overview)
and [quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart);
Electron [code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).
Written for OmniOrchestrator (Apache-2.0); no text is copied beyond the short
quotations marked above.
