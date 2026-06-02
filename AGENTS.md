# Repository Notes for Codex

This repository is a static research report archive released from `main`.

## Site Structure

- `index.html` is the main research index.
- `styles/site.css` contains the shared dark theme for the main index.
- `scripts/site.js` discovers project folders and builds the report list.
- Projects live under `projects/<slug>/`.
- Each project should expose its own `projects/<slug>/index.html`.

The main index reads project metadata from each project `index.html`:

- `<title>` or the first `<h1>` for the display title.
- Last commit date/time from the GitHub commits API for `projects/<slug>/`.

The main index should be written mostly in English. Project cards should not show thumbnails or report summaries. Keep cards focused on title, slug, publication state, last commit date/time, and the report link. Render commit time in 24-hour format.

Do not rely on project `assets/` files for report content or thumbnails. Project images should be base64-encoded and embedded into the report HTML before encryption so they are protected inside `report.enc`. Prefer raw base64 fields that the template converts to Blob URLs, rather than public asset references.

Use `projects/3dgs-ri/` as the baseline report layout: dark hero, left sticky contents rail, and right-side report content. `templates/report-template.html` is the repo-level starting point for new plaintext report bodies and should keep that 3dgs-ri-derived dark structure.

For GitHub-hosted browsing, `scripts/site.js` uses the GitHub Contents API for `Lukael/research` on `main`. For local static serving, it falls back to parsing the directory listing under `projects/`.

## Adding Projects

To add a new report project:

1. Create `projects/<slug>/index.html` as a public unlock shell.
2. Keep `projects/<slug>/assets/` empty or absent.
3. Start the plaintext report body from `templates/report-template.html`; it is based on the `3dgs-ri` dark two-column report layout.
4. Base64-encode report images and embed the encoded image data into the plaintext report HTML.
5. Keep plaintext templates outside `projects/` so the root index never discovers them.
6. Store the encrypted report payload as `projects/<slug>/report.enc`.
7. Serve the repo statically and verify the root index discovers the project automatically.

Do not hard-code new projects into the root `index.html` unless the discovery flow is intentionally being changed.

## Encrypted Reports

All project reports in this repository should be protected with client-side encryption. Project names and unlock shells may remain public, but report bodies and report media should not be committed as crawlable plaintext in the current tree.

- `projects/<slug>/index.html` should be only the unlock shell.
- Unlock shells should show only the project title above the password form. Do not add public subtitles, summaries, or report descriptions to the password page.
- `projects/<slug>/report.enc` should be the encrypted report payload.
- Report images, figures, plots, and other media should be base64-encoded and embedded inside the report HTML before encryption, not placed in public project assets.
- `templates/report-template.html` demonstrates the preferred raw base64 image fields and client-side Blob URL conversion; do not make public project images depend on `data:image` URLs or asset files.
- New and updated reports should follow the 3dgs-ri-derived dark layout unless a project has an explicit reason to diverge.
- New project `assets/` directories should remain empty or be omitted.
- `scripts/decrypt-report.js` handles password-based decrypt and renders the report in an iframe.

The report password is not stored in Git. Use the local environment variable `REPORT_PASSWORD` when re-encrypting report payloads. Do not print the password in command output, commit messages, logs, or documentation.

When Codex needs to decrypt, verify, or re-encrypt a report payload, first read the password from `process.env.REPORT_PASSWORD`. If it is not visible in the current process environment, check shell startup files for a `REPORT_PASSWORD` declaration without printing the value, then run the needed command through the shell that loads it. For this workspace, `zsh -f -c 'source ~/.zshrc >/dev/null 2>&1; ...'` has been used to load the local shell secret quietly.

The current payload uses:

- PBKDF2-SHA-256
- AES-256-GCM
- Random salt and IV per encryption

Because salt and IV are random, re-encrypting with the same password should still change `report.enc`. That is expected.

`projects/fm-fpm/` and `projects/3dgs-ri/` are current examples of this pattern. Future automation should read `process.env.REPORT_PASSWORD` or an equivalent runtime secret instead of embedding a password.

## Client-Side Encryption Caveats

Client-side encryption only hides report contents from casual crawling of the current published tree. It is not server-side access control.

Important caveats:

- Project names and unlock pages remain public.
- Public Git history may still contain earlier plaintext versions unless history is explicitly rewritten.
- Anyone with the password and the public encrypted payload can decrypt the report.
- If the password is lost, the encrypted payload cannot be recovered from the current tree without another plaintext source or older history.

## Verification

For small site changes, use targeted checks:

- `node --check scripts/decrypt-report.js`
- Static serving with `python3 -m http.server <port>`
- `curl -I` checks for root index, project index, scripts, and encrypted payloads.
- Confirm the root index does not render thumbnails or report summaries, and does render project last commit date/time when the GitHub commits API is reachable.
- For encrypted reports, verify Web Crypto decrypt using `REPORT_PASSWORD` without printing the secret. When touching a report payload, also confirm it has the 3dgs-ri-derived dark layout, contains no `data:image` strings, and stores report images as raw base64 attributes inside the encrypted HTML.

When changing frontend behavior, prefer a browser or Playwright smoke test if available.

## Git

The user has approved running Git commands without asking again. Keep commits small and follow the repository's Lore-style commit message format when committing.
