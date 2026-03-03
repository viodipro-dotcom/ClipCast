#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YouTube uploader helper for Creator Uploader.

Features:
- OAuth (Installed App flow). Stores token in yt_pipeline/outputs/youtube_token.json
- Uploads a single video with title/description/tags
- Can schedule via publishAt (RFC3339 UTC). We accept --publish-at-utc-ms epoch ms UTC from the app.

Setup (one-time):
1) Create OAuth client ID (Desktop app) in Google Cloud Console.
2) Download client secret JSON and save as:
   yt_pipeline/youtube_client_secret.json
3) pip install -r requirements_youtube.txt
4) Run: python -u youtube_uploader.py --auth-only
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

def eprint(*args):
    print(*args, file=sys.stderr)

def read_text(path: str | None) -> str:
    if not path:
        return ""
    p = Path(path)
    if not p.exists():
        return ""
    try:
        return p.read_text(encoding="utf-8").strip()
    except Exception:
        # best effort
        return p.read_text(errors="ignore").strip()

def find_client_secrets(base_dir: Path) -> Path | None:
    # env override
    env = os.environ.get("YOUTUBE_CLIENT_SECRETS")
    if env:
        p = Path(env)
        if p.exists():
            return p
    # default locations
    for name in ["youtube_client_secret.json", "client_secret.json", "client_secrets.json"]:
        p = base_dir / name
        if p.exists():
            return p
    return None

def token_path(outputs_dir: Path) -> Path:
    return outputs_dir / "youtube_token.json"

def load_youtube_service(client_secrets: Path, outputs_dir: Path):
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except Exception as ex:
        eprint("ERROR: Missing YouTube dependencies.")
        eprint("Install with: pip install -r requirements_youtube.txt")
        raise

    scopes = ["https://www.googleapis.com/auth/youtube.upload"]
    tok = token_path(outputs_dir)
    creds = None

    if tok.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(tok), scopes=scopes)
        except Exception:
            creds = None

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception:
            creds = None

    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets), scopes=scopes)
        # Opens browser for OAuth
        creds = flow.run_local_server(port=0)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        tok.write_text(creds.to_json(), encoding="utf-8")

    return build("youtube", "v3", credentials=creds)

def hashtags_to_tags(raw: str) -> list[str]:
    if not raw:
        return []
    parts = []
    for token in raw.replace(",", " ").split():
        t = token.strip()
        if not t:
            continue
        if t.startswith("#"):
            t = t[1:]
        if t:
            parts.append(t)
    # keep a reasonable number
    return parts[:20]

def ms_to_rfc3339_utc(ms: int) -> str:
    dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    # YouTube expects RFC3339, e.g. 2025-12-21T10:00:00Z
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")

def upload_video(youtube, file_path: Path, title: str, description: str, tags: list[str], visibility: str, publish_at_utc_ms: int | None):
    try:
        from googleapiclient.http import MediaFileUpload
    except Exception:
        eprint("ERROR: Missing googleapiclient. Install requirements_youtube.txt")
        raise

    body = {
        "snippet": {
            "title": title or file_path.stem,
            "description": description or "",
            "tags": tags or [],
            # categoryId optional; leaving out uses default
        },
        "status": {
            "privacyStatus": visibility or "private",
            "selfDeclaredMadeForKids": False,
        },
    }

    if publish_at_utc_ms is not None:
        # Scheduling works when privacyStatus is "private"
        body["status"]["publishAt"] = ms_to_rfc3339_utc(publish_at_utc_ms)
        if body["status"]["privacyStatus"] == "public":
            body["status"]["privacyStatus"] = "private"

    media = MediaFileUpload(str(file_path), chunksize=-1, resumable=True)

    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            print(f"[upload] progress={pct}%")

    return response

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--auth-only", action="store_true", help="Run OAuth flow and exit.")
    parser.add_argument("--file", type=str, help="Path to video file to upload.")
    parser.add_argument("--visibility", type=str, default="private", choices=["private", "unlisted", "public"])
    parser.add_argument("--publish-at-utc-ms", type=int, default=None)
    parser.add_argument("--time-zone", type=str, default="system")  # kept for compatibility / logging
    parser.add_argument("--title-file", type=str, default=None)
    parser.add_argument("--description-file", type=str, default=None)
    parser.add_argument("--hashtags-file", type=str, default=None)

    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    outputs_dir = base_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)

    secrets = find_client_secrets(base_dir)
    if not secrets:
        eprint("ERROR: YouTube client secrets not found.")
        eprint("Place OAuth client secret JSON here:")
        eprint(f"  {base_dir / 'youtube_client_secret.json'}")
        return 2

    print(f"[youtube] client_secrets={secrets}")
    print(f"[youtube] token={token_path(outputs_dir)}")

    youtube = load_youtube_service(secrets, outputs_dir)

    if args.auth_only:
        print("[youtube] auth ok")
        return 0

    if not args.file:
        eprint("ERROR: --file is required (unless --auth-only).")
        return 2

    file_path = Path(args.file)
    if not file_path.exists():
        eprint(f"ERROR: file not found: {file_path}")
        return 2

    title = read_text(args.title_file)
    description = read_text(args.description_file)
    hashtags = read_text(args.hashtags_file)
    tags = hashtags_to_tags(hashtags)

    print(f"[youtube] file={file_path}")
    print(f"[youtube] visibility={args.visibility} publishAtUtcMs={args.publish_at_utc_ms}")

    try:
        resp = upload_video(
            youtube=youtube,
            file_path=file_path,
            title=title,
            description=description,
            tags=tags,
            visibility=args.visibility,
            publish_at_utc_ms=args.publish_at_utc_ms,
        )
    except Exception as ex:
        eprint("ERROR: upload failed")
        eprint(str(ex))
        return 1

    vid = resp.get("id")
    print(f"[youtube] uploaded videoId={vid}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
