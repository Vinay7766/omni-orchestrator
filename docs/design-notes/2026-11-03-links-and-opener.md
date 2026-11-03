## Safe links and a narrower opener (RT-9, P-A10-07, P-A10-08, P-E8-02, P-E9-02) (2026-11-03)

Owner decision 2026-11-03 (option 2): fix the Medium problems before the v0.1 tester release.

Problem: a skill's source link went straight into `href`, so `data:` and `file:` links passed
(RT-9); the web view held `opener:default`, which allows http, https, mailto and tel links and
revealing files (P-A10-08), though no screen used the opener; addresses in the setup guide and
file paths and commits in the workflow details were plain text (P-E9-02, P-E8-02).

Constraints: link targets come from untrusted text (third-party skills, model output, memory
files); the plugin's permissions were read from its own source (tauri-plugin-opener 2.7.2:
`default` = allow-open-url + allow-reveal-item-in-dir + allow-default-urls); the Rust
`open_folder` command opens folders itself (it already refuses links, missing folders and
relative paths) and does not need the web view's opener permission.

Approaches considered:
- A: one check for every external link (https only, no user name or password in it, must parse),
  one link component that renders a link only when the check passes and opens it through the
  opener after checking again; the capability narrowed to `opener:allow-open-url` for
  `https://*` only. Files in the workflow details open their folder through `open_folder`;
  commits get a copy button.
- B: keep `href` links and rely on React's `javascript:` blocking plus the CSP. React passes
  `data:` and `file:` through (RT-9 shows it), and the capability would still allow more than the
  app uses.

Chosen: A.

Switch if: the app needs another scheme (then add it to both the check and the capability), or
files should open in an editor rather than the file manager.

Edge cases tested: https link opens; data:, file:, javascript:, http:, mailto: and a link with
credentials are refused and shown as text; a malformed link is text; the capability allows only
https; a file's folder is opened, never the file; a commit is copied.

Generalisation check: no site is special; the check is by scheme.

Assumptions to confirm: none.
