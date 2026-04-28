# ClipCast

**ClipCast** helps you prepare and **schedule** video posts for **YouTube**, **Instagram**, and **TikTok**: import files, run a **local pipeline** (transcription, AI-assisted metadata), then publish or use **Manual Assist** where the app does not upload for you. It is an open source **Electron** desktop app (internal package name: `yt_uploader_app`). API keys and OAuth are **bring your own** (BYOK) and live in the OS secure store, not in this repository.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Quick guide (typical flow):** **Install** · **Integrations** (OAuth / API keys) · **Add videos** · **Generate metadata** · **Plan** · **Publish** · optional **Auto Upload**

**More help:** step-by-step docs, screenshots, and troubleshooting live on the website — **[https://getclipcast.app/guide](https://getclipcast.app/guide)** (same content as the `website/` guide in this repo, kept up to date for end users).

## Features

- Import videos and folders; job table with scheduling, filters, and per-platform options  
- **Pipeline**: local speech-to-text, optional **OpenAI** for metadata and optional cloud transcript  
- **Exports** and templates for YouTube, Instagram, TikTok  
- **YouTube** upload and connection via **Google OAuth** (desktop flow)  
- **In-app updates** (electron-updater) when distributed with a configured update feed  
- **Internationalization** (i18n) in the UI  
- **Windows** installer (NSIS) with optional steps from [`installer.nsh`](installer.nsh) (e.g. startup, desktop shortcut)

## Tech stack

| Layer        | Technology |
|-------------|------------|
| Shell       | **Electron** (main: [`electron/main.mjs`](electron/main.mjs)) |
| Renderer    | **Vite** + **React** + **TypeScript** ([`src/`](src/)) |
| Pipeline    | **Python** ([`yt_pipeline/`](yt_pipeline/)), bundled from [`vendor/python`](vendor/python) in release builds |
| Media       | **ffmpeg**-family binaries under [`vendor/bin`](vendor/bin) where packaged |

## Requirements

- **Node.js 20+** (matches [CI](.github/workflows/release.yml) `node-version: '20'`)  
- **npm** (or compatible client) for installing root dependencies  
- **Windows** is the primary target for building and day-to-day use; `electron-builder` also lists a `mac` `dmg` target, but it is not guaranteed here—treat it as best-effort until verified on a Mac.

End users running a **prebuilt** installer do not need a separate system Python: the app ships an embedded/bundled Python tree in releases when `vendor/python` and related resources are present.

## Quick start (development)

```bash
git clone <your-fork-or-repo-url> clipcast
cd clipcast
npm ci   # or: npm install
npm run dev
```

[`npm run dev`](package.json) runs [`scripts/dev.mjs`](scripts/dev.mjs): it starts the **Vite** dev server (with port fallback) and then launches the **Electron** app pointed at that dev server so you can edit the React UI with hot reload.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite + Electron in development |
| `npm run build` | Production build of the renderer to `dist/` (Vite) |
| `npm run preview` | Preview the Vite build locally (no Electron) |
| `npm run build:icon` | Generate app icons (see [scripts/build-icon.mjs](scripts/build-icon.mjs)) |
| `npm run clean:outputs` | Clean pipeline output folders (see [scripts/clean-outputs.mjs](scripts/clean-outputs.mjs)) |
| `npm run prepare:cuda-dlls` | Prepare CUDA-related DLLs for packaging ([scripts/prepare-cuda-dlls.mjs](scripts/prepare-cuda-dlls.mjs)) |
| `npm run dist` | `prepare:cuda-dlls`, clean outputs, `build`, `build:icon`, then **electron-builder** with `--publish never` → outputs under `release/` |
| `npm run release` | Same as `dist` but **electron-builder** `--publish always` (needs publish + token configuration) |
| `npm test` | Runs the test entry in the `test` script in [package.json](package.json) (utility tests via `tsx`, if the entry file is present) |

## Building the desktop app

```bash
npm run dist
```

This produces a packaged app and installer (e.g. under [`release/`](package.json) per `build.directories.output`). The `dist` script already runs `prepare:cuda-dlls`, [`clean:outputs`](package.json), Vite `build`, and `build:icon` before **electron-builder**.

- **Full offline packaging** expects [`vendor/`](package.json) content such as `vendor/python`, `vendor/bin` (and optional CUDA material under `vendor/cuda/`) to match your [electron-builder `extraResources`](package.json) configuration. If those trees are missing, adapt your pipeline or document your local layout.  
- **Releases**: automation lives under [`.github/workflows/`](.github/workflows/). GitHub Releases on this repo use the workflow `GITHUB_TOKEN` (no separate release PAT). **OAuth client credentials are not bundled** in CI builds—each user creates their own Google Cloud OAuth client (see **YouTube** below). Do not commit secrets; optional secrets belong under **Settings → Secrets and variables → Actions** only if you extend the workflow.  
- **In-app updates (electron-updater)**: The update feed is defined by [`build.publish`](package.json) (`provider: github`, this repository). CI publishes `latest.yml` and installers here; installed apps load that metadata at install time. If a user still runs a build produced when the update feed pointed at a different GitHub repository, **in-app update will not switch feeds** until they install at least one release from **[Releases on this repo](https://github.com/viodipro-dotcom/ClipCast/releases)** manually; afterward updates follow these releases.

## Optional: marketing site (`website/`)

The [`website/`](website/) directory is a **Next.js** app (docs/marketing). It is **not** required to run the Electron app.

```bash
cd website
npm install
npm run dev     # local dev
npm run build   # production build
```

## Configuration (BYOK)

Nothing in this repository should contain real **API keys**, **OAuth client secrets**, or **tokens**. Use the in-app **Settings** screens (e.g. **Integrations**) so secrets are stored with **keytar** (or equivalent) in the user profile.

### OpenAI (metadata and optional cloud transcript)

1. In the app, open **Settings** → **Integrations**.  
2. Add an [OpenAI API key](https://platform.openai.com/api-keys). It is stored in the OS credential store, not in the project tree.  
3. Optionally enable cloud transcription via OpenAI `whisper-1` if you do not want to use the local model.

**Metadata generation** in this build uses your **OpenAI API key** only; there is no cloud-hosted Supabase or proxy in the desktop app.

### YouTube (OAuth and uploads)

Every user (and every developer) must **create their own** Google OAuth client. This repository and official installers **do not** ship a Google OAuth Client ID or Client Secret.

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.  
2. Enable **YouTube Data API v3** for that project.  
3. Configure the **OAuth consent screen** (External or Internal per your Google Workspace policy; add test users if the app is in *Testing*).  
4. In **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**, choose application type **Desktop app**. Note the **Client ID** and **Client secret**.  
5. In ClipCast, open **Settings** → **Integrations**, paste the **Client ID** and **Client secret**, save, then use **Connect YouTube** from the command bar. The app runs a local loopback server for the OAuth redirect (`http://127.0.0.1:<port>`).

Optional: [`assets/oauth/google_oauth_client.sample.json`](assets/oauth/google_oauth_client.sample.json) shows the JSON **shape** only (placeholders—not real credentials). For legacy migration you may still place a real `google_oauth_client.json` under the app user data folder once; the app migrates values into the OS store—**never commit** that file (see [`.gitignore`](.gitignore)).

**Advanced (development only):** you can supply credentials via environment variables `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (or `YT_GOOGLE_*`) so the main process picks them up without using the Integrations UI—useful for local debugging, not for end users.

## Project structure (overview)

```
.
├── src/            # React + TypeScript UI
├── electron/       # Main process, preload, IPC, auto-upload, YouTube, etc.
├── yt_pipeline/    # Python pipeline (transcribe, metadata, reports)
├── scripts/        # dev, build helpers, clean outputs, CUDA prep, etc.
├── vendor/         # Bundled python / ffmpeg (and related) for distribution builds
├── assets/         # Icons, OAuth JSON shape sample only (BYOK—no real secrets in repo)
├── build/          # Installer / icon sources (e.g. .ico)
├── website/        # Optional Next.js site (separate from Electron)
└── .github/        # CI (e.g. release workflow)
```

## Troubleshooting

### GPU and CUDA (Windows)

Having an **NVIDIA GPU** is **not enough** by itself: the **CUDA** paths inside ClipCast expect a recent driver stack (**CUDA 12.x–compatible** drivers on Windows). If your driver is too old, mismatched, or blocked by policy, ClipCast may **detect** the GPU but still **fall back to CPU** after a failed CUDA check — this is normal and keeps the app usable.

**Do this:**

1. Update **GeForce / Studio** drivers from [NVIDIA](https://www.nvidia.com/Download/index.aspx) (or your OEM), reboot, try again.  
2. In ClipCast open **Settings → Developer mode** and inspect **Compute backend**: **CUDA smoke test**, **Fallback reason**, and **Selected device**. Use **Refresh** after changing drivers.  
3. From a terminal, run `nvidia-smi` and confirm the reported CUDA version looks sane for your GPU.

Screenshots below match the online guide (**[Troubleshooting](https://getclipcast.app/guide/troubleshooting)** section — Developer mode UI):

| [![Developer mode — Settings](https://getclipcast.app/docs/images/settings/06-developer-mode.jpg)](https://getclipcast.app/guide/settings) |
|:--:|
| *Developer mode — compute backend and diagnostics (website screenshot).* |

For **step-by-step** fixes, CUDA notes, export paths, upload issues, and more detail than this readme, open **[https://getclipcast.app/guide](https://getclipcast.app/guide)** (full guide with search).

### Outputs folder

Pipeline outputs (audio, transcripts, metadata, exports, reports) go under a **single base directory** (default: `yt_pipeline/outputs` next to the app in dev; configurable in app settings).

1. **Settings** → **Developer mode** → **Outputs folder**  
2. **Browse…** to change; optional move of existing data; **Reset** for default.  
3. Structure: `<outputsBase>/Reports/`, `<outputsBase>/Exports/<Platform>/`, etc.

## Contributing

- Pull requests and issues are welcome. Keep changes **focused** and match existing **TypeScript** / **Python** style.  
- Do not commit **API keys**, **OAuth secrets**, or **tokens**—use local Integrations and gitignored paths (see [`.gitignore`](.gitignore)).  
- ESLint: [`.eslintrc.cjs`](.eslintrc.cjs).

## Security

If you find a **security vulnerability**, please report it **privately** (e.g. GitHub **Security** → **Advisories** for the repository, or a maintainer contact if one is published). Do not file critical exploit details in public issues before a fix is coordinated.

## License

This project is released under the [MIT License](LICENSE).
