# ClipCast

**ClipCast** helps you prepare and **schedule** video posts for **YouTube**, **Instagram**, and **TikTok**: bring in your videos, run transcription and AI-assisted metadata locally, then publish—or use **Manual Assist** where you finish the upload yourself in the browser. API keys and Google sign-in use your own credentials (**bring your own keys**); they are stored on your computer, not in this repository.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Ready to use:** you only need to **download the Windows installer** from **[GitHub Releases](https://github.com/viodipro-dotcom/ClipCast/releases)**, **install it**, and **open ClipCast**. No Git, no Node.js, no compiling from source, and no command line required for normal use.

## Get started

ClipCast is a **desktop app for Windows** shipped as a normal **`.exe` installer**—the same kind as most Windows programs.

1. Open **[Releases on GitHub](https://github.com/viodipro-dotcom/ClipCast/releases)** and download the latest **Windows installer** (`.exe`).
2. Run the installer and launch **ClipCast** from the Start menu.
3. In the app, go to **Settings** (gear menu) and set up **Integrations** (API keys / YouTube connection) as needed, then **add videos**, **generate metadata**, **plan** scheduling, and **publish**.

**Typical flow:** Install → **Settings** / **Integrations** → **Add videos** → **Generate metadata** → **Plan** → **Publish** · optional automation where supported.

**More help:** step-by-step guides, screenshots, and troubleshooting — **[getclipcast.app/guide](https://getclipcast.app/guide)**.

## Features

- Import videos and folders; table with scheduling, filters, and per-platform options  
- Speech-to-text and optional **OpenAI** for metadata (and optional cloud transcript)  
- Exports and templates for YouTube, Instagram, TikTok  
- **YouTube:** connect with your own Google OAuth app and upload or schedule  
- **In-app updates** when you install from [our GitHub Releases](https://github.com/viodipro-dotcom/ClipCast/releases) (updates follow new releases here)  
- Interface available in multiple languages  
- Windows installer with optional steps (startup, shortcuts, etc.)

## Configuration (bring your own keys)

Nothing in this repository should contain real **API keys**, **OAuth client secrets**, or **tokens**. Use the in-app **Settings** screens (for example **Integrations**) so secrets are stored securely on your machine.

### OpenAI (metadata and optional cloud transcript)

1. In the app, open **Settings** → **Integrations**.  
2. Add an [OpenAI API key](https://platform.openai.com/api-keys). It stays in the OS credential store, not in project files.  
3. Optionally turn on cloud transcription if you prefer that over the local path.

Metadata generation uses **your** OpenAI key; there is no separate cloud backend run by this project.

### YouTube (sign-in and uploads)

Each user creates a **Google OAuth “Desktop app”** in [Google Cloud Console](https://console.cloud.google.com/). Installers from this repo **do not** include a shared Google Client ID or secret.

1. Create or pick a project, enable **YouTube Data API v3**.  
2. Set up the **OAuth consent screen** (add test users if the app is in *Testing*).  
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**; note **Client ID** and **Client secret**.  
4. In ClipCast: **Settings** → **Integrations**, paste and save those values, then use **Connect YouTube** in the command bar.

Optional sample shape only: [`assets/oauth/google_oauth_client.sample.json`](assets/oauth/google_oauth_client.sample.json) (placeholders—never commit real secrets; see [`.gitignore`](.gitignore)).

**Developers only:** you can also pass `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (or `YT_GOOGLE_*`) for local debugging.

## Troubleshooting

### GPU and CUDA (Windows)

An **NVIDIA GPU** alone is not enough: drivers should be recent enough for **CUDA 12.x–compatible** use. If something fails, ClipCast may still run on **CPU**.

1. Update **NVIDIA** drivers from [nvidia.com](https://www.nvidia.com/Download/index.aspx), reboot, try again.  
2. In ClipCast: **Settings** → **Developer mode** → check **Compute backend** and **Refresh** after driver changes.  
3. In a terminal, `nvidia-smi` can confirm the driver reports a sensible CUDA version.

More detail: **[getclipcast.app/guide](https://getclipcast.app/guide)** (troubleshooting section).

| [![Developer mode — Settings](https://getclipcast.app/docs/images/settings/06-developer-mode.jpg)](https://getclipcast.app/guide/settings) |
|:--:|
| *Developer mode — compute backend (screenshot from the online guide).* |

### Outputs folder

Pipeline outputs (audio, transcripts, exports, reports) use one **base folder** you can change in the app.

1. **Settings** → **Developer mode** → **Outputs folder**  
2. **Browse…** or **Reset** for the default.  
3. Subfolders include things like `Reports/` and `Exports/<platform>/`.

## Contributing

Pull requests and issues are welcome. Keep changes focused and match the project’s style. Do not commit secrets—use Integrations locally. See also **For developers** below. ESLint: [`.eslintrc.cjs`](.eslintrc.cjs).

## Security

Please report security issues **privately** (for example GitHub **Security** → **Advisories** for this repository) before posting sensitive details in public issues.

## License

This project is released under the [MIT License](LICENSE).

---

## For developers

This section is for people working **in the source repository**. End users should use the **[GitHub Releases](https://github.com/viodipro-dotcom/ClipCast/releases)** installer instead of building from scratch.

### Tech stack

| Part    | Notes |
|--------|--------|
| App shell | Desktop runtime; main entry: [`electron/main.mjs`](electron/main.mjs) |
| User interface | Web-style UI in [`src/`](src/) |
| Video / AI pipeline | Python under [`yt_pipeline/`](yt_pipeline/); official builds bundle a runtime and tools in the installer |
| Media tools | Bundled helpers in release builds (`ffmpeg` / related) |

### Requirements (development only)

- **Node.js 20+** and **npm** (or compatible client) to install dependencies and run dev scripts  
- **Windows** is the main platform; other targets may be experimental  

Day-to-day users of the **prebuilt app** do not install Node or Python separately—the release bundles what the packaged app needs.

### Quick start (development)

```bash
git clone https://github.com/viodipro-dotcom/ClipCast.git
cd ClipCast
npm ci    # or: npm install
npm run dev
```

[`npm run dev`](package.json) starts the dev UI server and opens the desktop app against it (hot reload while editing the interface).

### npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development mode: UI server + desktop app |
| `npm run build` | Production UI build into `dist/` |
| `npm run preview` | Preview the UI build in a browser (no desktop shell) |
| `npm run build:icon` | Regenerate app icons ([`scripts/build-icon.mjs`](scripts/build-icon.mjs)) |
| `npm run clean:outputs` | Clean default pipeline output folders ([`scripts/clean-outputs.mjs`](scripts/clean-outputs.mjs)) |
| `npm run prepare:cuda-dlls` | Copy CUDA DLLs for local packaging ([`scripts/prepare-cuda-dlls.mjs`](scripts/prepare-cuda-dlls.mjs), Windows) |
| `npm run dist` | Full local packaging to `release/` (no upload) |
| `npm run release` | Same pipeline, then publish assets (needs token/config for GitHub upload) |
| `npm test` | Project test entry if configured |

### Installers and GitHub Releases

**Official Windows installers** (with bundled pipeline runtime and media tools) are built in **CI** and attached to **[GitHub Releases](https://github.com/viodipro-dotcom/ClipCast/releases)**. That is what most people should download.

Building a full installer **on your own machine** (`npm run dist` / `npm run release`) is only needed for maintainers or advanced testing. It expects a complete `vendor/` layout (bundled Python tree, binaries, optional CUDA copies) consistent with [`package.json`](package.json) `build.extraResources`. The [release workflow](.github/workflows/release.yml) prepares those pieces on the build server before packaging.

- **OAuth:** CI does not embed Google OAuth secrets; users still bring their own keys in the app.  
- **Updates:** The packaged app checks this repository’s release feed when updates are configured; installing at least one build from **[this repo’s Releases](https://github.com/viodipro-dotcom/ClipCast/releases)** aligns in-app updates with these assets.

### Optional: marketing site (`website/`)

The [`website/`](website/) folder is a separate **documentation / marketing** site. It is not required to run the desktop app.

```bash
cd website
npm install
npm run dev
npm run build
```

### Project structure (overview)

```
.
├── src/            # User interface
├── electron/       # Desktop app shell, connectivity, uploads, etc.
├── yt_pipeline/    # Local pipeline (transcribe, metadata, reports)
├── scripts/        # Dev helpers, cleaning, packaging prep
├── vendor/         # Filled by release automation (or manually for local full builds)
├── assets/         # Icons and non-secret samples
├── build/          # Icon sources
├── website/        # Optional docs site
└── .github/        # CI (e.g. release workflow)
```
