# run_pipeline.py
# -*- coding: utf-8 -*-

"""Creator Uploader - Python pipeline

What this script does per video:
1) Extracts audio with ffmpeg -> outputs/Audio/<name>.mp3
2) Transcribes audio with faster-whisper -> outputs/Transcripts/<name>.txt
3) Generates metadata with OpenAI -> outputs/Metadata/<name>.json
4) Exports per platform (YouTube/Instagram/TikTok) -> outputs/Exports/<Platform>/...

Key fix for your bug:
- The script NO LONGER blindly processes every video in a hardcoded folder.
- It accepts:
    --files  <file1> <file2> ...   (Electron app passes this)
    --folder <dir>                 (process all videos in dir recursively)
  If neither is provided, it can optionally fall back to VIDEOS_FOLDER env var.

Notes:
- Requires an ffmpeg binary. When launched from the ClipCast app, this is provided via the FFMPEG_PATH
  environment variable pointing to the bundled ffmpeg.exe; otherwise it falls back to \"ffmpeg\" on PATH.
- Requires pip install faster-whisper
- AI metadata is fetched via Supabase Edge Function proxy (requires SUPABASE_ACCESS_TOKEN).
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.util
import csv
import json
import os
import re
import sys
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set


# ----------------------------
# STDIO / ENCODING (Windows-safe)
# ----------------------------
# On Windows, Python may start with a legacy stdout/stderr encoding (e.g. cp1252),
# which can crash the pipeline if we print emojis or other non-ASCII characters.
# We reconfigure stdio to be UTF-8 and non-fatal.


def _configure_stdio() -> None:
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        # Never fail the pipeline because logging couldn't be configured.
        pass


_configure_stdio()


# ----------------------------
# SETTINGS (safe defaults)
# ----------------------------

# Optional fallback folder (if you run the script manually without --files/--folder)
VIDEOS_FOLDER = os.getenv("VIDEOS_FOLDER", "").strip()

# Speaker control (only included when include_speaker_name=True)
SPEAKER_NAME = os.getenv("SPEAKER_NAME", "").strip() or "Dr. Kent Hovind"

# OpenAI
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")  # Default to gpt-4o-mini (cheaper, fast)

# Faster-Whisper
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL_NAME", "medium")  # medium / large-v3 / etc
# Device: auto | cuda | cpu (default auto). Compute: auto | float16 | int8_float16 | int8 | float32 (default auto).
# Auto device uses GPU if available; auto compute picks float16 on GPU, int8 on CPU (avoids float16-on-CPU error in EXE).
_env_device = (os.getenv("WHISPER_DEVICE", "") or "").strip().lower()
WHISPER_DEVICE = _env_device if _env_device in ("auto", "cuda", "cpu") else "auto"
_env_compute = (os.getenv("WHISPER_COMPUTE_TYPE", "") or "").strip().lower()
WHISPER_COMPUTE_TYPE = _env_compute if _env_compute in ("auto", "float16", "int8_float16", "int8", "float32") else "auto"
CURRENT_WHISPER_DEVICE: Optional[str] = None

# If you want to force OpenMP duplicate workaround automatically:
KMP_DUPLICATE_LIB_OK = os.getenv("KMP_DUPLICATE_LIB_OK", "").strip().lower() in ("1", "true", "yes")

# How short is "too short" for a transcript (to avoid generating metadata from filename)
MIN_TRANSCRIPT_CHARS = int(os.getenv("MIN_TRANSCRIPT_CHARS", "40"))

# ffmpeg binary location (can be overridden via env from Electron)
FFMPEG_BIN = os.getenv("FFMPEG_PATH") or "ffmpeg"

# ----------------------------
# PATHS
# ----------------------------
# Optional: Electron app can set OUTPUTS_DIR env to a custom base (absolute path).
# If not set, use default: same folder as this script, under "outputs".

BASE_DIR = Path(__file__).resolve().parent
_env_outputs = os.getenv("OUTPUTS_DIR", "").strip()
if _env_outputs and Path(_env_outputs).is_absolute():
    OUTPUTS_DIR = Path(_env_outputs).resolve()
else:
    OUTPUTS_DIR = BASE_DIR / "outputs"
REPORTS_DIR = OUTPUTS_DIR / "Reports"

AUDIO_DIR = OUTPUTS_DIR / "Audio"
TRANSCRIPTS_DIR = OUTPUTS_DIR / "Transcripts"
METADATA_DIR = OUTPUTS_DIR / "Metadata"
EXPORTS_DIR = OUTPUTS_DIR / "Exports"


# ----------------------------
# HELPERS
# ----------------------------

def ensure_dirs() -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def safe_stem(name: str) -> str:
    """Normalize filename stem to a safe filesystem name for txt/json outputs."""
    s = name.strip()
    s = re.sub(r"[^\w\-\.\(\)\[\]\s']", "_", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip(" .")
    return s or "video"


def _normalize_path_for_stem(path_value: str) -> str:
    if not path_value:
        return ""
    try:
        resolved = str(Path(path_value).resolve())
    except Exception:
        resolved = str(path_value)
    if os.name == "nt":
        resolved = resolved.lower()
    return resolved.replace("\\", "/")


def _path_hash_for_stem(path_value: str) -> str:
    normalized = _normalize_path_for_stem(path_value)
    if not normalized:
        return "00000000"
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:8]


def stem_for_path(path_value: Path) -> str:
    base = safe_stem(path_value.stem)
    suffix = _path_hash_for_stem(str(path_value))
    return f"{base}__{suffix}"


ZERO_WIDTH_RE = re.compile(r"[\u200B\u200C\u200D\uFEFF]")
HASHTAG_TOKEN_RE = re.compile(r"#([^\s#]+)")
NON_WORD_RE = re.compile(r"[^\w]+", flags=re.UNICODE)
SHORT_CODE_RE = re.compile(r"^[A-Za-z]{1,3}\d{0,3}$")
NUMERIC_ONLY_RE = re.compile(r"^\d+$")
AMBIGUOUS_ALNUM_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{1,5}$")


def _is_ambiguous_short_tag(token: str) -> bool:
    t = str(token or "").strip()
    if not t:
        return True
    if NUMERIC_ONLY_RE.fullmatch(t):
        return True
    if SHORT_CODE_RE.fullmatch(t):
        return True
    if AMBIGUOUS_ALNUM_RE.fullmatch(t):
        return True
    return False


def _normalize_hashtag_token(token: str) -> List[str]:
    t = ZERO_WIDTH_RE.sub("", str(token or "")).strip()
    if not t:
        return []
    # Normalize fullwidth hashtag markers
    t = t.replace("＃", "#").replace("﹟", "#").replace("％", "%")
    candidates = HASHTAG_TOKEN_RE.findall(t) if "#" in t else [t]
    cleaned: List[str] = []
    for candidate in candidates:
        c = NON_WORD_RE.sub("", str(candidate).strip())
        if not c:
            continue
        if _is_ambiguous_short_tag(c):
            continue
        cleaned.append(f"#{c}")
    return cleaned


def norm_hashtags(tags: Any) -> List[str]:
    out: List[str] = []
    if not tags:
        return out
    if isinstance(tags, str):
        raw_tags: List[str] = [t for t in re.split(r"[,\s]+", tags) if t]
    elif isinstance(tags, list):
        raw_tags = [str(t) for t in tags]
    else:
        raw_tags = [str(tags)]

    for t in raw_tags:
        out.extend(_normalize_hashtag_token(t))

    seen = set()
    uniq: List[str] = []
    for t in out:
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(t)
    return uniq


def normalize_metadata_hashtags(meta: Dict[str, Any]) -> Dict[str, Any]:
    platforms = meta.get("platforms") if isinstance(meta, dict) else None
    if not isinstance(platforms, dict):
        return meta
    for key, pdata in platforms.items():
        if not isinstance(pdata, dict):
            continue
        pdata["hashtags"] = norm_hashtags(pdata.get("hashtags"))
    return meta


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def save_json(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8", errors="ignore"))


VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm"}


def list_videos_recursive(dir_path: Path) -> List[Path]:
    out: List[Path] = []
    for p in dir_path.rglob("*"):
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
            out.append(p)
    return sorted(out)


# ----------------------------
# VARIANT RULES
# ----------------------------

def detect_variant_type(video_path: Path) -> str:
    """Reads variant markers from the parent folder name."""
    folder = video_path.parent.name.lower()

    if "ai_video_ai_voice" in folder or "[ai_video_ai_voice]" in folder:
        return "ai_video_ai_voice"
    if "ai_video_original_voice" in folder or "[ai_video_original_voice]" in folder:
        return "ai_video_original_voice"
    if "original" in folder or "[original]" in folder:
        return "original"

    return "unknown"


def should_include_speaker_name(variant_type: str) -> bool:
    return (variant_type or "").strip().lower() == "original"


# ----------------------------
# FFMPEG: AUDIO EXTRACT
# ----------------------------

def run_ffmpeg_extract_mp3(video_path: Path, mp3_path: Path) -> None:
    """Extract mono 16kHz mp3. If mp3 exists -> do not recreate."""
    if mp3_path.exists() and mp3_path.stat().st_size > 1024:
        print(f"⏩ Audio exists, skipping extract: {mp3_path.name}")
        return

    cmd = [
        FFMPEG_BIN,
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "128k",
        str(mp3_path),
    ]
    subprocess.run(cmd, check=True)


# ----------------------------
# WHISPER (device/compute_type and CPU fallback)
# ----------------------------
# Env: WHISPER_DEVICE=auto|cuda|cpu, WHISPER_COMPUTE_TYPE=auto|float16|int8_float16|int8|float32.
# Auto device uses GPU if detected; auto compute uses float16 on GPU, int8 on CPU (avoids float16-on-CPU in EXE).
# On GPU failure (load or mid-transcription), we fall back to CPU with int8, then float32 if int8 fails.

def resolve_whisper_settings(
    device_pref: str,
    compute_pref: str,
    cuda_available: bool,
) -> tuple[str, str]:
    """
    Resolve (device, compute_type) from preferences and CUDA availability.
    Use when device_pref is 'auto' | 'cuda' | 'cpu' and compute_pref is 'auto' | 'float16' | 'int8_float16' | 'int8' | 'float32'.
    Caller should set cuda_available from detect_gpu_capability()[0] == 'cuda' when in auto mode.
    """
    if device_pref in ("cuda", "cpu"):
        device = device_pref
    else:
        device = "cuda" if cuda_available else "cpu"
    if compute_pref != "auto":
        compute = compute_pref
    else:
        if device == "cuda":
            compute = "float16"
        else:
            compute = "int8"
    return (device, compute)


def detect_gpu_capability():
    """
    Conservative CUDA runtime check (no optimistic fallback).
    Returns: (device, compute_type) tuple: ("cuda", "float16") or ("cpu", "int8")
    """
    try:
        import ctranslate2  # type: ignore[import-not-found]
        count = int(ctranslate2.get_cuda_device_count() or 0)
        if count <= 0:
            print("⚠️  CUDA runtime not available (no CUDA devices reported by ctranslate2)")
            return ("cpu", "int8")
        supported = list(ctranslate2.get_supported_compute_types("cuda") or [])
        if "float16" not in [s.lower() for s in supported]:
            print("⚠️  CUDA detected but float16 not supported by ctranslate2")
            return ("cpu", "int8")
        print(f"✅ CUDA runtime detected via ctranslate2 (devices={count})")
        return ("cuda", "float16")
    except Exception as e:
        print(f"⚠️  CUDA runtime check failed: {e}")
        return ("cpu", "int8")


def load_whisper_model(device_override: Optional[str] = None):
    _maybe_fix_openmp_conflict()
    # Import faster_whisper early to catch any import-time CUDA errors
    try:
        from faster_whisper import WhisperModel
    except Exception as import_error:
        error_str = str(import_error).lower()
        if "cuda" in error_str or "cudnn" in error_str or "dll" in error_str:
            print(f"⚠️  CUDA/cuDNN error during import: {import_error}")
            print("🔄 Falling back to CPU mode...")
            # Force CPU mode if import fails due to CUDA
            device = "cpu"
            compute_type = "int8"
            try:
                from faster_whisper import WhisperModel
                print(f"🚀 Loading Whisper model on {device} ({WHISPER_MODEL_NAME}, {compute_type}) ...")
                model = WhisperModel(
                    WHISPER_MODEL_NAME,
                    device=device,
                    compute_type=compute_type,
                )
                print(f"✅ Whisper loaded on {device} with compute_type={compute_type}")
                return model
            except Exception as e:
                print(f"❌ Failed to load Whisper model: {e}")
                raise
        else:
            raise

    global CURRENT_WHISPER_DEVICE

    # Determine desired device / compute_type via resolve_whisper_settings.
    # Precedence: explicit override (CLI) > env vars (WHISPER_DEVICE, WHISPER_COMPUTE_TYPE) > auto-detect.
    device_pref = (device_override or WHISPER_DEVICE).strip().lower() if (device_override or WHISPER_DEVICE) else "auto"
    compute_pref = WHISPER_COMPUTE_TYPE
    if device_pref == "auto":
        auto_device, _ = detect_gpu_capability()
        cuda_available = auto_device == "cuda"
        if cuda_available:
            print("✅ CUDA runtime detected, using CUDA mode")
        else:
            print("ℹ️  CUDA runtime not available, using CPU mode")
    else:
        cuda_available = device_pref == "cuda"
    device, compute_type = resolve_whisper_settings(device_pref, compute_pref, cuda_available)
    CURRENT_WHISPER_DEVICE = device
    print(f"Whisper: device={device}, compute_type={compute_type} (from WHISPER_DEVICE={WHISPER_DEVICE!r}, WHISPER_COMPUTE_TYPE={WHISPER_COMPUTE_TYPE!r})")
    
    # If device is set to CUDA, try to use it directly
    # faster-whisper will handle CUDA errors gracefully and we'll catch them below
    # We don't need PyTorch to check CUDA - faster-whisper uses ctranslate2 which has its own CUDA detection
    
    # Try to load the model with error handling
    # Note: cuDNN DLL errors may occur at model initialization, not in Python exception handling
    # If the process crashes with exit code 3221226505, it's a DLL loading error
    # IMPORTANT: If you see "Could not locate cudnn_ops64_9.dll" error, the process will crash
    # before Python can catch it. In that case, set WHISPER_DEVICE=cpu to force CPU mode.
    if device == "cuda":
        print(
            f"🚀 Attempting to load Whisper model on CUDA ({WHISPER_MODEL_NAME}, {compute_type}) ..."
        )
        print("   ⚠️  If you see 'cudnn_ops64_9.dll' error, CUDA/cuDNN is not properly installed.")
        print("   💡 Solution: Set WHISPER_DEVICE=cpu or install cuDNN from NVIDIA")
        try:
            model = WhisperModel(
                WHISPER_MODEL_NAME,
                device=device,
                compute_type=compute_type,
            )
            print("✅ Successfully loaded model on CUDA")
            return model
        except (RuntimeError, OSError, ImportError, Exception) as e:
            error_msg = str(e).lower()
            # CUDA/cuDNN error or float16 not supported on device (e.g. fallback to CPU with wrong compute_type)
            is_cuda_or_float16_error = (
                "cuda" in error_msg or "cudnn" in error_msg or "dll" in error_msg
                or ("float16" in error_msg and ("do not support" in error_msg or "target device" in error_msg or "backend" in error_msg))
            )
            if is_cuda_or_float16_error:
                print(f"⚠️  GPU/compute error detected: {e}")
                print("🔄 GPU failed, retrying on CPU with compute_type=int8")
                device = "cpu"
                compute_type = "int8"
                CURRENT_WHISPER_DEVICE = device
            else:
                raise
    else:
        print(
            f"🚀 Loading Whisper model on {device} ({WHISPER_MODEL_NAME}, {compute_type}) ..."
        )

    # Load on CPU (either because device was CPU, or because CUDA failed)
    try:
        model = WhisperModel(
            WHISPER_MODEL_NAME,
            device=device,
            compute_type=compute_type,
        )
        print(f"✅ Whisper loaded on {device} with compute_type={compute_type}")
        return model
    except Exception as cpu_error:
        if device != "cpu" or compute_type == "float32":
            print(f"❌ Failed to load Whisper model on {device}: {cpu_error}")
            raise
        print(f"⚠️  CPU {compute_type} compute_type failed: {cpu_error}")
        print("🔄 CPU int8 compute_type failed, retrying with float32")
        compute_type = "float32"
        try:
            model = WhisperModel(
                WHISPER_MODEL_NAME,
                device=device,
                compute_type=compute_type,
            )
            print(f"✅ Whisper loaded on {device} with compute_type={compute_type}")
            return model
        except Exception as e2:
            print(f"❌ Failed to load Whisper model on {device} (float32): {e2}")
            raise


def transcribe_to_text(model, mp3_path: Path) -> str:
    segments, _info = model.transcribe(
        str(mp3_path),
        beam_size=5,
        vad_filter=True,
    )
    parts: List[str] = []
    for seg in segments:
        txt = (seg.text or "").strip()
        if txt:
            parts.append(txt)
    return " ".join(parts).strip()


def _is_gpu_error(exc: BaseException) -> bool:
    """True if the exception indicates GPU/compute failure (e.g. float16 on CPU mid-run)."""
    msg = str(exc).lower()
    patterns = [
        "cuda out of memory",
        "cuda error",
        "cublas",
        "cudnn",
        "no kernel image",
        "dll load failed",
        "could not locate cudnn",
        "cudart",
        "float16",
    ]
    return any(p in msg for p in patterns)


def _maybe_fix_openmp_conflict() -> None:
    if not os.getenv("CLIPCAST_PY_ENV"):
        return
    try:
        prefix = sys.prefix
        conda_omp = os.path.join(prefix, "Library", "bin", "libiomp5md.dll")
        spec = importlib.util.find_spec("ctranslate2")
        if not spec or not spec.origin:
            return
        pkg_dir = os.path.dirname(spec.origin)
        ct2_omp = os.path.join(pkg_dir, "libiomp5md.dll")
        if not (os.path.isfile(conda_omp) and os.path.isfile(ct2_omp)):
            return
        disabled = ct2_omp + ".disabled"
        if os.path.isfile(disabled):
            return
        os.rename(ct2_omp, disabled)
        print(f"[openmp] Disabled duplicate libiomp5md.dll in ctranslate2: {ct2_omp}")
    except Exception as exc:
        print(f"[openmp] Failed to disable duplicate libiomp5md.dll: {exc}")


def _release_whisper_model(model) -> None:
    try:
        print("[compute] Cleanup: releasing Whisper model")
        del model
    except Exception as exc:
        print(f"[compute] Cleanup error: {exc}")
    try:
        gc.collect()
        time.sleep(0.2)
        print("[compute] Cleanup: gc complete")
    except Exception as exc:
        print(f"[compute] Cleanup gc error: {exc}")


def _add_dll_dirs_for_python_root() -> None:
    if not hasattr(os, "add_dll_directory"):
        return
    python_exe = sys.executable or ""
    python_dir = os.path.dirname(python_exe)
    python_root = python_dir
    if python_dir.lower().endswith("\\scripts"):
        python_root = os.path.dirname(python_dir)
    dirs = [
        python_dir,
        python_root,
        os.path.join(python_root, "Library", "bin"),
        os.path.join(python_root, "DLLs"),
        os.path.join(python_root, "bin"),
    ]
    for directory in dirs:
        if directory and os.path.isdir(directory):
            try:
                os.add_dll_directory(directory)
            except Exception:
                pass


# ----------------------------
# OPENAI METADATA
# ----------------------------

def normalize_language_text(text: str) -> str:
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    return normalized.encode("ascii", "ignore").decode("ascii").lower()


def detect_script_hint(text: str) -> Optional[str]:
    if not text:
        return None
    normalized = unicodedata.normalize("NFKC", text)
    counts = {
        "hiragana": len(re.findall(r"[\u3040-\u309F]", normalized)),
        "katakana": len(re.findall(r"[\u30A0-\u30FF]", normalized)),
        "han": len(re.findall(r"[\u4E00-\u9FFF]", normalized)),
        "hangul": len(re.findall(r"[\uAC00-\uD7AF]", normalized)),
        "devanagari": len(re.findall(r"[\u0900-\u097F]", normalized)),
        "cyrillic": len(re.findall(r"[\u0400-\u04FF]", normalized)),
        "arabic": len(re.findall(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]", normalized)),
    }
    if counts["hiragana"] + counts["katakana"] > 0:
        return "Japanese script (Hiragana/Katakana)"
    if counts["hangul"] > 0:
        return "Korean script (Hangul)"
    if counts["han"] > 0:
        return "Chinese script (Han)"
    if counts["devanagari"] > 0:
        return "Devanagari script"
    if counts["cyrillic"] > 0:
        return "Cyrillic script"
    if counts["arabic"] > 0:
        return "Arabic script"
    return None


LANGUAGE_ALIASES = {
    "english": ["english", "englez", "engleza"],
    "romanian": ["romanian", "romana", "moldovenesc", "moldoveneasca", "limba romana"],
    "spanish": ["spanish", "espanol", "spaniol", "spaniola", "limba spaniola"],
    "russian": ["russian", "rus", "rusa", "rusesc", "limba rusa"],
    "hindi": ["hindi", "हिन्दी", "हिंदी", "limba hindi", "indian", "indiana", "limba indiana"],
}

LANGUAGE_DISPLAY = {
    "english": "English",
    "romanian": "Romanian",
    "spanish": "Spanish",
    "russian": "Russian",
    "hindi": "Hindi",
}

LANGUAGE_STOPWORDS = {
    "english": {
        "the", "and", "of", "to", "in", "for", "with", "on", "is", "are", "be", "this", "that", "your", "you",
        "as", "it", "from", "by", "or", "at", "an", "a", "we", "our", "they", "their", "not", "do",
    },
    "romanian": {
        "si", "sau", "in", "din", "la", "pentru", "este", "sunt", "cu", "ca", "pe", "fara", "nu", "de",
        "o", "un", "una", "al", "ale", "ai", "ale", "putem", "trebuie", "mai", "foarte",
    },
    "spanish": {
        "el", "la", "de", "y", "para", "con", "que", "en", "los", "las", "un", "una", "por", "es", "son",
        "como", "no", "su", "se", "al", "del", "mas", "muy",
    },
}


def normalize_language_name(raw_language: str) -> Optional[str]:
    if not raw_language:
        return None
    raw_language = raw_language.strip()
    if "/" in raw_language:
        parts = [p.strip() for p in raw_language.split("/") if p.strip()]
        if parts:
            raw_language = parts[-1]
    if not raw_language:
        return None
    normalized = normalize_language_text(raw_language)
    if not normalized:
        return raw_language
    if "moldoven" in normalized:
        return "Romanian (Moldovenesc-friendly)"
    for key, aliases in LANGUAGE_ALIASES.items():
        for alias in aliases:
            alias_norm = normalize_language_text(alias)
            if alias_norm and alias_norm in normalized:
                return LANGUAGE_DISPLAY.get(key, raw_language.strip())
    return raw_language


def detect_explicit_language_request(instructions_text: str) -> Optional[str]:
    if not instructions_text:
        return None
    language_keyword_patterns = [
        r"\b(language|lang)\b\s*[:\-]\s*(?P<lang>[^;\n,.]+)",
        r"\b(limba|limbă)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(язык)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(idioma|lengua)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(langue)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(sprache)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(lingua)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(j[eę]zyk)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(dil)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(언어)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(言語|语言)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(لغة)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
        r"\b(भाषा)\b\s*[:\-]?\s*(?P<lang>[^;\n,.]+)",
    ]
    for pattern in language_keyword_patterns:
        match = re.search(pattern, instructions_text, flags=re.IGNORECASE)
        if match:
            raw_lang = match.group("lang")
            resolved = normalize_language_name(raw_lang)
            if resolved:
                return resolved

    original_patterns = [
        r"\b(output\s+language|language)\s*[:\-]\s*(?P<lang>[^;\n,.]+)",
        r"\b(limba|in limba|în limba)\s+(?P<lang>[^;\n,.]+)",
        r"\b(generate|write|produce|output|return|scrie|genereaza|creeaza)\b[^;\n]{0,60}?\b(in|în)\s+(?P<lang>[^;\n,.]+)",
        r"\b(язык)\s*[:\-]\s*(?P<lang>[^;\n,.]+)",
        r"\bна\s+(?P<lang>[^;\n,.]+?)\s+языке\b",
    ]
    for pattern in original_patterns:
        match = re.search(pattern, instructions_text, flags=re.IGNORECASE)
        if match:
            raw_lang = match.group("lang")
            resolved = normalize_language_name(raw_lang)
            if resolved:
                return resolved

    def looks_like_language_token(raw_lang: str) -> bool:
        if not raw_lang:
            return False
        raw_lang = raw_lang.strip()
        if not raw_lang:
            return False
        if len(raw_lang) < 2:
            return False
        platform_words = [
            "platform", "platforms", "platforma", "platforme", "platformy",
            "платформ", "平台", "プラットフォーム", "プラットホーム", "플랫폼",
            "منصة", "منصات", "plataforma", "plateforme", "plattform", "piattaforma",
        ]
        raw_lang_norm = normalize_language_text(raw_lang)
        if raw_lang_norm and any(p in raw_lang_norm for p in platform_words):
            return False
        if any(p in raw_lang.lower() for p in platform_words if isinstance(p, str)):
            return False
        if "/" in raw_lang:
            return True
        if re.search(r"[^\x00-\x7F]", raw_lang):
            return True
        return True

    preposition_patterns = [
        r"\b(na|на)\s+(?P<lang>[^;\n,.]+)",
        r"\b(po|по)\s+(?P<lang>[^;\n,.]+)",
        r"\b(in|în|en|em|auf)\s+(?P<lang>[^;\n,.]+)",
        r"\b(w)\s+(?P<lang>[^;\n,.]+)",
        r"\b(ba|باللغة)\s+(?P<lang>[^;\n,.]+)",
    ]
    for pattern in preposition_patterns:
        match = re.search(pattern, instructions_text, flags=re.IGNORECASE)
        if match:
            raw_lang = match.group("lang")
            raw_lang = re.split(r"[;,\.\n]", raw_lang)[0].strip()
            if looks_like_language_token(raw_lang):
                resolved = normalize_language_name(raw_lang)
                if resolved:
                    return resolved

    normalized = normalize_language_text(instructions_text)
    directive_patterns = [
        r"\b(output language|language)\s*[:\-]\s*(?P<lang>[^;\n,.]+)",
        r"\b(limba|in limba|în limba)\s+(?P<lang>[^;\n,.]+)",
        r"\b(generate|write|produce|output|return|scrie|genereaza|creeaza)\b[^;\n]{0,40}?\b(in|în)\s+(?P<lang>[^;\n,.]+)",
    ]
    for pattern in directive_patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match:
            raw_lang = match.group("lang")
            resolved = normalize_language_name(raw_lang)
            if resolved:
                return resolved

    for key, aliases in LANGUAGE_ALIASES.items():
        for alias in aliases:
            alias_norm = normalize_language_text(alias)
            if alias_norm and re.search(rf"\b(in|în)\s+{re.escape(alias_norm)}\b", normalized):
                return LANGUAGE_DISPLAY.get(key)

    if any(keyword in normalized for keyword in ["language", "limba", "scrie in", "genereaza in", "write in", "generate in"]):
        for key, aliases in LANGUAGE_ALIASES.items():
            for alias in aliases:
                alias_norm = normalize_language_text(alias)
                if alias_norm and alias_norm in normalized:
                    return LANGUAGE_DISPLAY.get(key)
    return None


def detect_implicit_language(instructions_text: str) -> Optional[str]:
    if not instructions_text:
        return None
    return None


def resolve_output_language(instructions_text: str, settings_language: Optional[str] = None) -> str:
    if not instructions_text or not instructions_text.strip():
        return settings_language or "English"
    explicit = detect_explicit_language_request(instructions_text)
    if explicit:
        return explicit
    implicit = detect_implicit_language(instructions_text)
    if implicit:
        return implicit
    script_hint = detect_script_hint(instructions_text)
    if script_hint:
        return f"Use the same language as the user instructions (script: {script_hint}). Do NOT default to English."
    return "Use the same language as the user instructions. Do NOT default to English."


def resolve_output_language_for_platform(
    all_text: str,
    platform_text: str,
    settings_language: Optional[str] = None,
) -> str:
    platform_text = (platform_text or "").strip()
    all_text = (all_text or "").strip()

    if platform_text:
        explicit_platform = detect_explicit_language_request(platform_text)
        if explicit_platform:
            return explicit_platform
        implicit_platform = detect_implicit_language(platform_text)
        if implicit_platform:
            return implicit_platform

    if all_text:
        explicit_all = detect_explicit_language_request(all_text)
        if explicit_all:
            return explicit_all
        implicit_all = detect_implicit_language(all_text)
        if implicit_all:
            return implicit_all

    if platform_text or all_text:
        script_hint = detect_script_hint(platform_text or all_text)
        if script_hint:
            return f"Use the same language as the user instructions (script: {script_hint}). Do NOT default to English."
        return "Use the same language as the user instructions. Do NOT default to English."
    if settings_language:
        return settings_language
    return "English"


def wants_identical_description(instructions_text: str) -> bool:
    if not instructions_text or not instructions_text.strip():
        return False
    original_lower = instructions_text.lower()
    original_normalized = unicodedata.normalize("NFKC", instructions_text).lower()
    normalized = normalize_language_text(instructions_text)

    def contains_any(text: str, tokens: List[str]) -> bool:
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            if token in text:
                return True
        return False

    def token_present(token: str) -> bool:
        token = token.strip()
        if not token:
            return False
        token_norm = normalize_language_text(token)
        if token_norm and token_norm in normalized:
            return True
        token_lower = token.lower()
        return token_lower in original_lower or token_lower in original_normalized

    same_terms = [
        "same", "identical", "the same", "exact same",
        "aceeasi", "acelasi", "identic", "la fel",
        "одинаков", "идентичн",
        "相同", "一致", "同一", "一样",
        "同じ", "同一", "一致", "同様",
        "동일", "같은", "일치",
        "نفس", "مطابق", "متطابق", "مماثل",
        "समान", "एक जैसा", "एकसमान", "एक-सा", "एक समान",
        "однаков", "ідентичн",
        "taki sam", "identyczn", "jednakow",
        "mesmo", "igual", "idêntic", "identic",
        "misma", "igual", "idéntic", "identic",
        "même", "identique", "pareil",
        "gleich", "identisch",
        "stesso", "uguale", "identic",
        "aynı", "özdeş",
    ]
    description_terms = [
        "description", "desc", "text",
        "descriere", "descrierea", "descrieri", "text",
        "описан", "описание", "текст",
        "描述", "说明", "简介", "内容", "文本",
        "説明", "記述", "説明文", "内容", "テキスト",
        "설명", "내용", "텍스트",
        "وصف", "شرح", "نص",
        "विवरण", "वर्णन", "टेक्स्ट", "डिस्क्रिप्शन",
        "опис", "текст",
        "opis", "tekst",
        "descrição", "texto",
        "descripción", "texto",
        "description", "texte",
        "beschreibung", "text",
        "descrizione", "testo",
        "açıklama", "metin", "içerik",
    ]
    platform_terms = [
        "platform", "platforms",
        "platforma", "platforme",
        "платформ",
        "平台",
        "プラットフォーム", "プラットホーム", "sns", "ＳＮＳ", "媒体",
        "플랫폼",
        "منصة", "منصات",
        "प्लेटफॉर्म", "प्लेटफ़ॉर्म", "प्लैटफॉर्म", "प्लैटफ़ॉर्म", "मंच",
        "платформ",
        "platforma", "platformy",
        "plataforma", "plataformas",
        "plateforme", "plateformes",
        "plattform", "plattformen",
        "piattaforma", "piattaforme",
        "platform", "platformlar",
    ]

    has_same = any(token_present(t) for t in same_terms)
    has_desc = any(token_present(t) for t in description_terms)
    has_platform = any(token_present(t) for t in platform_terms)

    if has_same and has_desc and has_platform:
        return True

    # Secondary: allow "same/identical for all platforms" without explicit description word
    if has_same and has_platform and (
        contains_any(normalized, ["all", "three", "3", "toate", "trei"])
        or contains_any(original_lower, ["всех", "три", "全て", "すべて", "모든", "所有", "全部", "toutes", "todas", "tutte", "सभी"])
        or contains_any(original_normalized, ["全て", "すべて", "ＳＮＳ"])
    ):
        return True

    return False


def detect_explicit_sources_request(instructions_text: str) -> bool:
    if not instructions_text or not instructions_text.strip():
        return False

    normalized = normalize_language_text(instructions_text)
    original_lower = instructions_text.lower()

    verbs = [
        "include", "add", "provide", "list", "show", "append",
        "cite", "cites", "citations", "reference", "references",
        "adauga", "adaugă", "include", "includeti", "includeți", "citeaza", "citează",
        "incluye", "anade", "añade", "agrega", "agregue", "cita", "citas",
        "добав", "укаж", "привед", "ссылай",
    ]
    source_keywords = [
        "source", "sources", "surse", "sursa",
        "references", "reference", "citations", "citation", "bibliography", "bibliografie",
        "fuentes", "fuente", "referencias",
        "источник", "источники", "цитаты", "цитата",
    ]
    link_keywords = [
        "link", "links", "url", "urls", "linkuri", "enlaces", "enlace",
        "ссылка", "ссылки",
    ]

    has_source = any(re.search(rf"\b{re.escape(k)}\b", normalized) for k in source_keywords)
    has_link = any(re.search(rf"\b{re.escape(k)}\b", normalized) for k in link_keywords)
    has_verb = any(re.search(rf"\b{re.escape(v)}\b", normalized) for v in verbs)

    if has_source and (has_link or has_verb):
        return True
    if has_link and has_verb and any(k in normalized for k in ["source", "sources", "references", "citations", "bibliography", "surse", "sursa"]):
        return True

    # Unicode checks (for languages not preserved by ASCII normalization)
    unicode_sources = ["источник", "источники", "ссылка", "ссылки", "цитата", "цитаты"]
    unicode_verbs = ["добав", "укаж", "привед", "ссылай", "включи", "включай"]
    if any(token in original_lower for token in unicode_sources) and any(v in original_lower for v in unicode_verbs):
        return True

    return False


PLATFORM_PATTERNS = {
    "youtube": r"\b(youtube|yt)\b",
    "instagram": r"\b(instagram|ig)\b",
    "tiktok": r"\b(tiktok|tt)\b",
}


def detect_platform_mentions(text: str) -> Set[str]:
    if not text:
        return set()
    mentioned: Set[str] = set()
    for key, pattern in PLATFORM_PATTERNS.items():
        if re.search(pattern, text, flags=re.IGNORECASE):
            mentioned.add(key)
    return mentioned


def extract_platform_specific_instructions(text: str) -> Dict[str, str]:
    if not text:
        return {}
    combined = r"|".join(PLATFORM_PATTERNS.values())
    marker_re = re.compile(combined, flags=re.IGNORECASE)
    matches = list(marker_re.finditer(text))
    result: Dict[str, str] = {"youtube": "", "instagram": "", "tiktok": ""}

    # First pass: segment between platform markers
    if matches:
        for idx, match in enumerate(matches):
            label = match.group(0).lower()
            platform_key = None
            for key, pattern in PLATFORM_PATTERNS.items():
                if re.fullmatch(pattern, label, flags=re.IGNORECASE):
                    platform_key = key
                    break
            if not platform_key:
                continue
            next_start = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
            segment = text[match.end():next_start].strip(" :\t\r\n-–—,;=/")
            if segment:
                if result[platform_key]:
                    result[platform_key] = f"{result[platform_key]}\n{segment}"
                else:
                    result[platform_key] = segment

    extracted = {k: v for k, v in result.items() if v}
    mentions = detect_platform_mentions(text)

    # Fallback: clause-based parsing (comma/semicolon/newline/pipe separated)
    if mentions and len(extracted) < len(mentions):
        clauses = re.split(r"[;\n\|]|,(?!\d)", text)
        platform_marker = re.compile(combined, flags=re.IGNORECASE)
        cleanup_words = [
            r"description", r"descriere", r"описание", r"説明", r"설명", r"描述",
            r"beschreib\w*", r"descri[cç][aã]o", r"descripci[oó]n", r"descrizione",
            r"a[çc]ıklama", r"説明文",
        ]
        connector_words = [
            r"for", r"pentru", r"para", r"pour", r"für", r"per", r"для", r"に", r"で", r"위해",
        ]
        for clause in clauses:
            clause_text = clause.strip()
            if not clause_text:
                continue
            match = platform_marker.search(clause_text)
            if not match:
                continue
            label = match.group(0).lower()
            platform_key = None
            for key, pattern in PLATFORM_PATTERNS.items():
                if re.fullmatch(pattern, label, flags=re.IGNORECASE):
                    platform_key = key
                    break
            if not platform_key:
                continue
            cleaned = clause_text
            cleaned = re.sub(PLATFORM_PATTERNS[platform_key], "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(rf"\b({'|'.join(cleanup_words)})\b", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(rf"\b({'|'.join(connector_words)})\b", "", cleaned, flags=re.IGNORECASE)
            cleaned = cleaned.strip(" :\t\r\n-–—,;=/")
            if cleaned:
                if extracted.get(platform_key):
                    extracted[platform_key] = f"{extracted[platform_key]}\n{cleaned}"
                else:
                    extracted[platform_key] = cleaned

    return {k: v for k, v in extracted.items() if v}


def remove_platform_specific_from_all(text: str, platform_segments: Dict[str, str]) -> str:
    if not text or not platform_segments:
        return text
    cleaned = text
    for segment in platform_segments.values():
        if not segment:
            continue
        cleaned = cleaned.replace(segment, "")
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = cleaned.strip(" ,;\n\t")
    return cleaned


def extract_target_word_count(instructions_text: str) -> Optional[int]:
    if not instructions_text or not instructions_text.strip():
        return None

    normalized = normalize_language_text(instructions_text)
    word_tokens = [
        "word", "words",
        "cuvant", "cuvinte", "cuvintele",
        "palabras", "mots", "worter", "woerter", "parole", "palavras",
    ]
    for token in word_tokens:
        match = re.search(rf"(~|≈|about|around|approx|approximately)?\s*(\d{{2,5}})\s*{token}\b", normalized)
        if match:
            return int(match.group(2))

    original_lower = instructions_text.lower()
    unicode_word_tokens = ["слов", "слова", "словa", "словe", "词", "單詞", "单词"]
    for token in unicode_word_tokens:
        match = re.search(rf"(~|≈|about|around|примерно|около)?\s*(\d{{2,5}})\s*{re.escape(token)}", original_lower)
        if match:
            return int(match.group(2))

    return None


def resolve_target_words_for_platform(all_text: str, platform_text: str, max_words: int) -> Optional[int]:
    platform_text = (platform_text or "").strip()
    all_text = (all_text or "").strip()

    target = extract_target_word_count(platform_text) or extract_target_word_count(all_text)
    if not target:
        return None
    if max_words and target > max_words:
        return max_words
    return target


def count_words(text: str) -> int:
    if not text:
        return 0
    return len([w for w in re.split(r"\s+", text.strip()) if w])

def trigger_external_sources_heuristic(instructions_text: str) -> bool:
    normalized = normalize_language_text(instructions_text)
    original_lower = (instructions_text or "").lower()
    if not normalized and not original_lower.strip():
        return False
    if "http://" in normalized or "https://" in normalized or "www." in normalized:
        return True
    if "url" in normalized:
        return True

    link_tokens = ["link", "links", "enlace", "enlaces", "lien", "liens", "linkuri"]
    link_tokens_unicode = ["ссылка", "ссылки"]
    if any(token in normalized for token in link_tokens) or any(token in original_lower for token in link_tokens_unicode):
        return True

    citation_tokens = [
        "cite", "citation", "citations", "bibliography", "references", "referinte", "bibliografie",
        "fuentes", "referencias", "références",
    ]
    citation_tokens_unicode = ["источники", "цитаты"]
    if any(token in normalized for token in citation_tokens) or any(token in original_lower for token in citation_tokens_unicode):
        return True

    return False


def has_sources_hint(instructions_text: str) -> bool:
    normalized = normalize_language_text(instructions_text)
    original_lower = (instructions_text or "").lower()
    if not normalized and not original_lower.strip():
        return False
    hints = [
        "sources", "source", "surse", "sursa",
        "fuente", "fuentes",
        "references", "referinte", "referencias", "referenze", "referenzen",
        "bibliografie", "bibliography", "bibliografia",
        "fonte", "fonti", "quelle", "quellen", "kilde", "kilder",
    ]
    hints_unicode = ["источник", "источники", "출처", "来源", "來源", "参考", "参考文献"]
    return any(token in normalized for token in hints) or any(token in original_lower for token in hints_unicode)


def classify_sources_intent(instructions_text: str) -> str:
    if not instructions_text:
        return "none"
    try:
        label = call_openai_proxy(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Return exactly one label: external_links | transcript_only | none. "
                        "external_links = user asks for URLs/citations/bibliography/links. "
                        "transcript_only = user asks to include sources mentioned in transcript/video. "
                        "none = no sources request."
                    ),
                },
                {"role": "user", "content": f"Instruction:\n{instructions_text}"},
            ],
            temperature=0,
        ).strip().lower()
        if "external_links" in label:
            return "external_links"
        if "transcript_only" in label:
            return "transcript_only"
        if "none" in label:
            return "none"
        return "none"
    except Exception as e:
        print(f"⚠️  Sources intent classification failed: {e}")
        return "none"


def extract_allowed_urls(instructions_text: str) -> List[str]:
    if not instructions_text:
        return []
    urls = re.findall(r"(https?://[^\s\)\]\}<>\"']+|www\.[^\s\)\]\}<>\"']+)", instructions_text, flags=re.IGNORECASE)
    cleaned = []
    for url in urls:
        trimmed = url.rstrip(".,;:!?)\"]'")
        if trimmed:
            cleaned.append(trimmed)
    return list(dict.fromkeys(cleaned))


def strip_unapproved_urls(text: str, allowed_urls: List[str]) -> str:
    if not text:
        return text
    allowed = set(allowed_urls or [])

    def _replace(match: re.Match) -> str:
        url = match.group(0)
        trimmed = url.rstrip(".,;:!?)\"]'")
        return url if trimmed in allowed else ""

    cleaned = re.sub(r"(https?://[^\s\)\]\}<>\"']+|www\.[^\s\)\]\}<>\"']+)", _replace, text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def _resolve_supabase_functions_url() -> str:
    url = os.getenv("SUPABASE_FUNCTIONS_URL", "").strip()
    if url:
        return url.rstrip("/")
    base = os.getenv("SUPABASE_URL", "").strip()
    if not base:
        return ""
    return base.rstrip("/") + "/functions/v1"



def call_openai_proxy(
    messages: List[Dict[str, str]],
    model: str,
    response_format: Optional[Dict[str, Any]] = None,
    temperature: float = 0.7,
) -> str:
    token = os.getenv("SUPABASE_ACCESS_TOKEN", "").strip()
    functions_url = _resolve_supabase_functions_url()
    if not token:
        raise ValueError("Missing Supabase access token. Please sign in and try again.")
    if not functions_url:
        raise ValueError("Missing SUPABASE_FUNCTIONS_URL. Please configure the app and try again.")

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format

    req = urllib.request.Request(
        f"{functions_url}/generate-metadata",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if hasattr(e, "read") else ""
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {}
        msg = data.get("error") or raw or str(e)
        raise ValueError(f"OpenAI proxy error: {msg}")

    if not isinstance(data, dict) or not data.get("ok"):
        raise ValueError(data.get("error") or "OpenAI proxy error")

    return str(data.get("content") or "")


def extract_search_keywords(transcript: str, min_count: int = 5, max_count: int = 10) -> List[str]:
    if not transcript:
        return []
    tokens = re.findall(r"[A-Za-zĂÂÎȘȚăâîșț]+", transcript)
    if not tokens:
        return []
    stopwords = {
        "the", "and", "of", "to", "in", "for", "with", "on", "is", "are", "be", "this", "that", "your", "you",
        "as", "it", "from", "by", "or", "at", "an", "a", "we", "our", "they", "their", "not", "do",
        "si", "sau", "in", "din", "la", "pentru", "este", "sunt", "cu", "ca", "pe", "fara", "nu", "de",
        "o", "un", "una", "al", "ale", "ai", "mai", "foarte",
    }
    counts: Dict[str, int] = {}
    for token in tokens:
        lower = token.lower()
        if lower in stopwords or len(lower) < 3:
            continue
        counts[lower] = counts.get(lower, 0) + 1
    if not counts:
        return []
    sorted_tokens = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    picked = [token for token, _count in sorted_tokens][:max_count]
    if len(picked) < min_count:
        picked = [token for token, _count in sorted_tokens][:min_count]
    return picked


def ensure_sources_block(description: str, keywords: List[str]) -> str:
    block_header = "Surse (adaugă manual):"
    if block_header in (description or ""):
        return description
    keywords_text = ", ".join(keywords) if keywords else ""
    block = (
        f"\n\n{block_header}\n"
        "- [ADD SOURCE LINK 1]\n"
        "- [ADD SOURCE LINK 2]\n"
        "- [ADD SOURCE LINK 3]\n"
        f"Cuvinte cheie pentru căutare: {keywords_text}"
    )
    return f"{(description or '').strip()}{block}"


def wants_long_description(instructions_text: str) -> bool:
    normalized = normalize_language_text(instructions_text)
    if not normalized:
        return False

    long_keywords = [
        "detaliata", "detaliat", "detaliate", "detaliat",
        "lunga", "lung", "mai lunga", "mai lung", "mai detaliat", "mai detaliata",
        "long", "longer", "detailed", "in depth", "in-depth", "extended",
        "cuvinte cheie", "keywords", "multe cuvinte",
    ]
    if any(keyword in normalized for keyword in long_keywords):
        return True

    if re.search(r"\b\d+\s*(word|words|character|characters|chars|line|lines|cuvinte|cuvant|cuvintele)\b", normalized):
        return True

    return False


STRUCTURED_KEYWORDS_RAW = [
    # English
    "structured", "organized", "organised", "structure", "outline",
    "sections", "section", "headings", "heading", "subheadings",
    "bullet points", "bulleted", "bullets", "list", "paragraphs", "paragraph",
    # Romanian
    "structurat", "organizat", "structura", "sectiuni", "sectiune", "titluri",
    "puncte", "liste", "paragrafe", "paragraf",
    # Russian / Ukrainian
    "структур", "пункты", "список", "абзац", "раздел", "заголов",
    # Spanish
    "estructurado", "organizado", "secciones", "seccion", "titulos",
    "viñetas", "puntos", "parrafos", "parrafo",
    # French
    "structuré", "organisé", "sections", "section", "titres",
    "puces", "paragraphes", "paragraphe",
    # German
    "strukturiert", "absatze", "absatz", "aufzaehlung", "punkte", "uberschrift",
    # Italian
    "strutturato", "sezioni", "sezione", "elenchi", "punti", "paragrafi",
    # Portuguese
    "estruturado", "secoes", "secoes", "topicos", "paragrafos", "paragrafo",
    # Turkish
    "duzenli", "bolumler", "bolum", "madde isaretleri", "paragraflar",
    # Arabic
    "منظم", "مُهيكل", "نقاط", "فقرات", "عناوين",
    # Hindi
    "संरचित", "बुलेट", "पैराग्राफ", "खंड",
    # Chinese
    "结构化", "分段", "要点", "小节",
    # Japanese
    "構造化", "箇条書き", "段落", "見出し",
    # Korean
    "구조화", "문단", "불릿", "섹션",
    # Polish
    "strukturyzowany", "zorganizowany", "sekcje", "sekcja", "punktowanie", "akapity",
]

STRUCTURED_EXPLICIT_PATTERNS = [
    r"\bstructured\b",
    r"\borganised\b",
    r"\borganized\b",
    r"\bstructure\b",
    r"\boutline\b",
    r"\bsections?\b",
    r"\bheadings?\b",
    r"\bsubheadings?\b",
    r"\bbullet points?\b",
    r"\bbulleted\b",
    r"\bbullets\b",
    r"\bparagraphs?\b",
    r"\bformat(?:ted)?\s+(as|with)\b",
    r"\borganize\b",
    r"\borganise\b",
]

STRUCTURED_KEYWORDS_ASCII = [normalize_language_text(k) for k in STRUCTURED_KEYWORDS_RAW if normalize_language_text(k)]
STRUCTURED_KEYWORDS_UNICODE = [k.lower() for k in STRUCTURED_KEYWORDS_RAW if not normalize_language_text(k)]


def has_structured_formatting_heuristic(instructions_text: str) -> bool:
    if not instructions_text:
        return False

    normalized = normalize_language_text(instructions_text)
    for pattern in STRUCTURED_EXPLICIT_PATTERNS:
        if re.search(pattern, normalized):
            return True

    for keyword in STRUCTURED_KEYWORDS_ASCII:
        if " " in keyword:
            if keyword in normalized:
                return True
        else:
            if re.search(rf"\b{re.escape(keyword)}\b", normalized):
                return True
    original_lower = instructions_text.lower()
    if any(keyword in original_lower for keyword in STRUCTURED_KEYWORDS_UNICODE):
        return True

    return False


def classify_structured_intent(instructions_text: str) -> str:
    instructions_text = instructions_text or ""
    try:
        label = call_openai_proxy(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "Return exactly one label: structured | default.",
                },
                {"role": "user", "content": instructions_text},
            ],
            temperature=0,
        ).strip().lower()
        if "structured" in label:
            return "structured"
        if "default" in label:
            return "default"
        return "default"
    except Exception as e:
        print(f"⚠️  Structured intent classification failed: {e}")
        return "default"


def _strip_sources_placeholder(text: str) -> str:
    if not text:
        return text
    # Remove known placeholder blocks to avoid duplication in structured formatting
    patterns = [
        r"surse\s*\(adaug[aă]\s+manual\)\s*:",
        r"sources\s*\(add\s+manually\)\s*:",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return text[:match.start()].strip()
    return text


def _strip_hashtags_from_text(text: str) -> str:
    if not text:
        return text
    cleaned = re.sub(r"(?:^|\s)#[^\s#]+", " ", text)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def strip_block_text(description: str, block_text: str) -> str:
    if not description or not block_text:
        return description
    raw = block_text.strip()
    if not raw:
        return description

    cleaned = description.replace(raw, "")

    normalized_block = re.sub(r"\s+", " ", raw).strip()
    if normalized_block:
        pattern = re.escape(normalized_block).replace(r"\ ", r"\s+")
        cleaned = re.sub(pattern, " ", cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def _split_sentences(text: str) -> List[str]:
    if not text:
        return []
    parts = re.split(r"(?<=[\.\!\?。！？])\s+", text.strip())
    return [p.strip() for p in parts if p and p.strip()]


def _split_phrases(text: str) -> List[str]:
    if not text:
        return []
    parts = re.split(r"[;,:\u2022·]\s*", text.strip())
    return [p.strip() for p in parts if p and p.strip()]


def format_structured_description(
    description: str,
    include_sources: bool,
    source_keywords: List[str],
) -> str:
    cleaned = _strip_sources_placeholder(description or "")
    cleaned = _strip_hashtags_from_text(cleaned)

    lines = [line.strip() for line in re.split(r"\n+", cleaned) if line.strip()]
    bullet_lines: List[str] = []
    sentence_lines: List[str] = []
    for line in lines:
        match = re.match(r"^\s*[-*•]\s+(.*)$", line)
        if match:
            bullet_lines.append(match.group(1).strip())
        else:
            sentence_lines.append(line)

    sentences: List[str] = []
    for line in sentence_lines:
        sentences.extend(_split_sentences(line))

    intro_sentences = sentences[:3] if sentences else []
    if not intro_sentences and bullet_lines:
        intro_sentences = bullet_lines[:1]
    intro = " ".join(intro_sentences).strip()

    remaining_sentences = sentences[len(intro_sentences):]
    bullet_candidates = bullet_lines + remaining_sentences

    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for item in bullet_candidates:
        key = normalize_language_text(item) or item.lower()
        if key in seen:
            continue
        seen.add(key)
        if item.strip():
            deduped.append(item.strip())

    # Ensure at least 3 key points by splitting phrases if needed
    if len(deduped) < 3:
        phrase_pool = []
        for item in sentences + bullet_lines:
            phrase_pool.extend(_split_phrases(item))
        for phrase in phrase_pool:
            key = normalize_language_text(phrase) or phrase.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(phrase.strip())
            if len(deduped) >= 3:
                break

    key_points = deduped[:6]
    highlights_candidates = deduped[6:]
    highlights = highlights_candidates[:4] if len(highlights_candidates) >= 2 else []

    sections: List[str] = []
    if intro:
        sections.append(intro)

    if key_points:
        section = ["Key points / Topics:"]
        section.extend([f"- {item}" for item in key_points])
        sections.append("\n".join(section))

    if highlights:
        section = ["Highlights:"]
        section.extend([f"- {item}" for item in highlights])
        sections.append("\n".join(section))

    if include_sources:
        sources_block = [
            "Sources (add manually):",
            "- [ADD SOURCE LINK 1]",
            "- [ADD SOURCE LINK 2]",
            "- [ADD SOURCE LINK 3]",
        ]
        if source_keywords:
            sources_block.append(f"Search keywords: {', '.join(source_keywords)}")
        sections.append("\n".join(sources_block))

    return "\n\n".join([s for s in sections if s]).strip()


def create_empty_platform_map() -> Dict[str, str]:
    return {"all": "", "youtube": "", "instagram": "", "tiktok": ""}


def normalize_platform_map(value: Any) -> Dict[str, str]:
    base = create_empty_platform_map()
    if isinstance(value, str):
        base["all"] = value.strip()
        return base
    if isinstance(value, dict):
        for key in base:
            raw = value.get(key, "")
            if isinstance(raw, str):
                base[key] = raw.strip()
    return base


SPEAKER_NAME_OVERRIDE_RE = re.compile(
    r"\[\[\s*speaker(?:[_\s-]?name)?\s*:\s*([^\]]+?)\s*\]\]",
    flags=re.IGNORECASE,
)


def _clean_speaker_name_candidate(raw: str) -> Optional[str]:
    if not raw:
        return None
    candidate = str(raw).strip().strip(" \"'`")
    for sep in [" and ", " si ", " și ", " in ", " pentru ", "/", "|", ";", ",", "\n"]:
        if sep in candidate:
            candidate = candidate.split(sep)[0].strip()
    candidate = candidate.strip(" .:;!-")
    if len(candidate) < 2 or len(candidate) > 80:
        return None
    if candidate.lower() in {"speaker", "vorbitor", "prezentator", "gazda", "host", "presenter"}:
        return None
    if not re.search(r"[A-Za-zÀ-ÖØ-öø-ÿĂÂÎȘȚăâîșț]", candidate):
        return None
    return candidate


def extract_speaker_name_from_instructions(text: str) -> Optional[str]:
    if not text:
        return None
    explicit = SPEAKER_NAME_OVERRIDE_RE.search(text)
    if explicit:
        return _clean_speaker_name_candidate(explicit.group(1))

    patterns = [
        r"(?:speaker\s*name|speaker)\s*(?:is|:)\s*([^\n\r]+)",
        r"(?:numele\s+vorbitorului|numele\s+speakerului|numele\s+prezentatorului|prezentatorul|gazda|vorbitor)\s*(?:este|e|:)\s*([^\n\r]+)",
        r"(?:host|presenter)\s*(?:is|:)\s*([^\n\r]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            candidate = _clean_speaker_name_candidate(match.group(1))
            if candidate:
                return candidate
    return None


def normalize_blocks(value: Any) -> Dict[str, Dict[str, str]]:
    if not isinstance(value, dict):
        value = {}
    return {
        "cta": normalize_platform_map(value.get("cta")),
        "links": normalize_platform_map(value.get("links")),
        "disclaimer": normalize_platform_map(value.get("disclaimer")),
    }


def load_metadata_settings(user_data_dir: str) -> Dict[str, Any]:
    defaults = {
        "customInstructions": create_empty_platform_map(),
        "descriptionTemplate": create_empty_platform_map(),
        "blocks": normalize_blocks({}),
    }
    settings_file = os.path.join(user_data_dir, "metadata_settings.json")
    if not os.path.exists(settings_file):
        return defaults
    try:
        with open(settings_file, "r", encoding="utf-8") as f:
            settings = json.load(f)
        return {
            "customInstructions": normalize_platform_map(settings.get("customInstructions")),
            "descriptionTemplate": normalize_platform_map(settings.get("descriptionTemplate")),
            "blocks": normalize_blocks(settings.get("blocks")),
        }
    except Exception as e:
        print(f"⚠️  Failed to read metadata settings: {e}")
        return defaults


_UI_LANGUAGE_OPTIONS_CACHE: Optional[Dict[str, str]] = None


def load_ui_language_options() -> Dict[str, str]:
    global _UI_LANGUAGE_OPTIONS_CACHE
    if _UI_LANGUAGE_OPTIONS_CACHE is not None:
        return _UI_LANGUAGE_OPTIONS_CACHE
    options: Dict[str, str] = {}
    try:
        languages_file = BASE_DIR.parent / "src" / "i18n" / "languages.ts"
        if languages_file.exists():
            raw = read_text(languages_file)
            for obj in re.findall(r"\{[^}]*\}", raw):
                code_match = re.search(r"code:\s*['\"]([^'\"]+)['\"]", obj)
                label_match = re.search(r"label:\s*['\"]([^'\"]+)['\"]", obj)
                if code_match and label_match:
                    options[code_match.group(1)] = label_match.group(1)
    except Exception:
        options = {}
    _UI_LANGUAGE_OPTIONS_CACHE = options
    return options


def resolve_settings_language(user_data_dir: Optional[str]) -> Optional[str]:
    if not user_data_dir:
        return None
    ui_settings_path = Path(user_data_dir) / "ui_settings.json"
    if not ui_settings_path.exists():
        return None
    try:
        settings = json.loads(ui_settings_path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return None
    if not isinstance(settings, dict):
        return None

    for key in ("uiLanguageLabel", "uiLanguageName", "uiLanguageDisplay", "uiLanguage"):
        value = settings.get(key)
        if isinstance(value, str) and value.strip():
            value = value.strip()
            if key == "uiLanguage":
                mapped = load_ui_language_options().get(value)
                if mapped:
                    return mapped
            return value
    return None


def merge_platform_text(base: str, override: str) -> str:
    parts = []
    if base:
        parts.append(base)
    if override:
        parts.append(override)
    return "\n\n".join(parts).strip()


def apply_identical_description(platforms_map: Dict[str, Any], platforms_to_process: List[str]) -> None:
    source_platform = None
    source_description = ""
    for key in platforms_to_process:
        desc = str(platforms_map.get(key, {}).get("description", "")).strip()
        if len(desc) > len(source_description):
            source_description = desc
            source_platform = key
    if source_description:
        for key in platforms_to_process:
            if isinstance(platforms_map.get(key), dict):
                platforms_map[key]["description"] = source_description
        print(f"[customAI] identical description applied | source={source_platform or '?'} len={len(source_description)}")


def build_platform_instruction_map(settings: Dict[str, Any], platforms: List[str]) -> Dict[str, str]:
    resolved = {p: resolve_custom_ai(p, settings) for p in platforms}
    return {p: (resolved.get(p, {}).get("mergedInstructions") or "").strip() for p in platforms}


def should_split_generation(settings: Dict[str, Any], platforms: List[str]) -> bool:
    if len(platforms) <= 1:
        return False
    instructions_map = build_platform_instruction_map(settings, platforms)
    unique = {v for v in instructions_map.values() if v}
    return len(unique) > 1


def resolve_custom_ai(platform: str, settings: Dict[str, Any]) -> Dict[str, Any]:
    base_instructions_map = normalize_platform_map(settings.get("customInstructions"))
    all_instructions = base_instructions_map.get("all", "")
    platform_segments = extract_platform_specific_instructions(all_instructions)
    platform_mentions = detect_platform_mentions(all_instructions)
    has_partial_segments = (
        bool(platform_segments)
        and platform_mentions
        and len(platform_segments) < len(platform_mentions)
        and len(platform_mentions) > 1
    )
    if has_partial_segments:
        print(
            "[customAI] partial per-platform directives | keeping all global"
        )
    cleaned_all = (
        all_instructions
        if has_partial_segments
        else remove_platform_specific_from_all(all_instructions, platform_segments)
    )
    instructions_map = {
        "all": cleaned_all,
        "youtube": merge_platform_text(base_instructions_map.get("youtube", ""), platform_segments.get("youtube", "")),
        "instagram": merge_platform_text(base_instructions_map.get("instagram", ""), platform_segments.get("instagram", "")),
        "tiktok": merge_platform_text(base_instructions_map.get("tiktok", ""), platform_segments.get("tiktok", "")),
    }
    template_map = normalize_platform_map(settings.get("descriptionTemplate"))
    blocks_map = {
        "cta": normalize_platform_map(settings.get("blocks", {}).get("cta")),
        "links": normalize_platform_map(settings.get("blocks", {}).get("links")),
        "disclaimer": normalize_platform_map(settings.get("blocks", {}).get("disclaimer")),
    }

    merged_instructions = merge_platform_text(instructions_map.get("all", ""), instructions_map.get(platform, ""))
    merged_template = merge_platform_text(template_map.get("all", ""), template_map.get(platform, ""))
    merged_blocks = {
        "cta": merge_platform_text(blocks_map["cta"].get("all", ""), blocks_map["cta"].get(platform, "")),
        "links": merge_platform_text(blocks_map["links"].get("all", ""), blocks_map["links"].get(platform, "")),
        "disclaimer": merge_platform_text(blocks_map["disclaimer"].get("all", ""), blocks_map["disclaimer"].get(platform, "")),
    }

    return {
        "instructionsMap": instructions_map,
        "templateMap": template_map,
        "blocksMap": blocks_map,
        "mergedInstructions": merged_instructions,
        "template": merged_template,
        "blocks": merged_blocks,
        "platformSegments": platform_segments,
    }


def preview_text(text: str, limit: int = 200) -> str:
    if not text:
        return ""
    flat = text.replace("\n", "\\n")
    return flat[:limit] + ("..." if len(flat) > limit else "")


def safe_len(s: Any) -> int:
    """Return length of string, or 0 if not a string."""
    if s is None:
        return 0
    return len(s) if isinstance(s, str) else 0


def short_hash(s: Any, length: int = 8) -> str:
    """Return first `length` chars of sha256 hex digest (no content logged)."""
    raw = (s if isinstance(s, str) else "") or ""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:length]


def extract_json_from_text(text: str) -> Any:
    text = (text or "").strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        chunk = text[start : end + 1]
        try:
            return json.loads(chunk)
        except Exception:
            pass

    return None


def openai_generate_metadata(
    transcript: str,
    filename_hint: str,
    include_speaker_name: Optional[bool],
    speaker_name_override: Optional[str],
    variant_type: str,
    allowed_platforms: List[str] = None,
) -> Dict[str, Any]:
    _t0 = time.perf_counter()

    def _log_customai_error(e: Exception) -> None:
        _code = type(e).__name__[:12]
        _msg = (str(e) or "unknown")[:60].replace("\n", " ").replace("|", "")
        print(f"[customAI] Error | code={_code} msg={_msg}")
        print(f"[customAI] Done           | ms={int((time.perf_counter() - _t0) * 1000)} ok=false")

    include_speaker_name_effective = include_speaker_name
    if speaker_name_override:
        include_speaker_name_effective = True

    platforms_for_schema = allowed_platforms if allowed_platforms else ["youtube", "instagram", "tiktok"]
    schema = {
        "platforms": {
            platform_key: {"title": "", "description": "", "hashtags": []}
            for platform_key in platforms_for_schema
        }
    }

    # Try to load active custom AI settings
    user_data_dir = os.getenv("APP_USER_DATA")
    settings = load_metadata_settings(user_data_dir) if user_data_dir else {
        "customInstructions": create_empty_platform_map(),
        "descriptionTemplate": create_empty_platform_map(),
        "blocks": normalize_blocks({}),
    }
    settings_language = resolve_settings_language(user_data_dir) if user_data_dir else None
    instructions_map = settings.get("customInstructions", create_empty_platform_map())
    template_map = settings.get("descriptionTemplate", create_empty_platform_map())
    blocks_map = settings.get("blocks", {}) or {}

    def has_any_value(value: Dict[str, str]) -> bool:
        return any(isinstance(v, str) and v.strip() for v in value.values())

    block_count = sum(
        1 for b in ("cta", "links", "disclaimer")
        if has_any_value(blocks_map.get(b, create_empty_platform_map()))
    )
    _lang = (settings_language or "default")[:20].replace("|", "")
    print(f"[customAI] Preset selected | presetId= presetName= lang={_lang} blocks={block_count}")

    platforms_for_prompt = allowed_platforms if allowed_platforms else ["youtube", "instagram", "tiktok"]
    _yt = "on" if "youtube" in platforms_for_prompt else "off"
    _ig = "on" if "instagram" in platforms_for_prompt else "off"
    _tt = "on" if "tiktok" in platforms_for_prompt else "off"
    print(f"[customAI] Plan summary   | yt={_yt} ig={_ig} tt={_tt} mode=gen")

    _tlen = safe_len(transcript)
    print(f"[customAI] Input stats    | titleLen=0 descLen=0 tagsLen=0 transcriptLen={_tlen}")

    resolved_by_platform = {p: resolve_custom_ai(p, settings) for p in platforms_for_prompt}
    effective_instructions = (
        resolved_by_platform[platforms_for_prompt[0]]["instructionsMap"]
        if platforms_for_prompt
        else create_empty_platform_map()
    )

    sources_intent_by_platform: Dict[str, bool] = {}
    allowed_urls_by_platform = {
        platform: extract_allowed_urls(resolved_by_platform[platform]["mergedInstructions"])
        for platform in platforms_for_prompt
    }

    wants_structured_description_by_platform: Dict[str, bool] = {}
    for platform in platforms_for_prompt:
        instructions_text = resolved_by_platform[platform]["mergedInstructions"]
        wants_structured = has_structured_formatting_heuristic(instructions_text)
        wants_structured_description_by_platform[platform] = wants_structured

    for platform in platforms_for_prompt:
        instructions_text = resolved_by_platform[platform]["mergedInstructions"]
        wants_sources = detect_explicit_sources_request(instructions_text)
        sources_intent_by_platform[platform] = wants_sources

    def build_combined_instructions() -> str:
        parts = []
        if effective_instructions.get("all"):
            parts.append(effective_instructions.get("all", ""))
        for platform in platforms_for_prompt:
            platform_text = effective_instructions.get(platform, "").strip()
            if platform_text:
                parts.append(platform_text)
        return "\n".join(parts).strip()

    def build_instructions_prompt_block() -> str:
        lines = []
        if effective_instructions.get("all"):
            lines.extend([
                "APPLIES TO ALL PLATFORMS:",
                effective_instructions.get("all", ""),
                "",
            ])
        for platform in platforms_for_prompt:
            platform_text = effective_instructions.get(platform, "").strip()
            if platform_text:
                lines.extend([
                    f"{platform.title()} ONLY (in addition to ALL):",
                    platform_text,
                    "",
                ])
        return "\n".join(lines).strip()

    combined = build_combined_instructions()
    force_same_description = wants_identical_description(combined)
    if force_same_description:
        print("[customAI] enforcing identical descriptions | platforms=same")
    instructions_prompt_block = build_instructions_prompt_block()

    # Build prompt with custom instructions if provided
    custom_instructions_section = ""
    if combined:
        custom_instructions_section = f"\n\nAdditional user instructions:\n{combined}\n"

    # Build platform-specific rules, but allow custom instructions to override
    youtube_rules = "   - description: 2-6 short lines, no emojis"
    instagram_rules = "   - description: 1-3 short lines (hook + summary), NO CTA by default"
    tiktok_rules = "   - description: 1-2 lines"
    
    # If custom instructions mention emojis, remove the "no emojis" restriction for YouTube
    # Check combined instructions across relevant platforms
    if combined and ("emoji" in combined.lower() or "emojis" in combined.lower()):
        youtube_rules = "   - description: 2-6 short lines"
    
    # If custom instructions mention length/words/characters/lines, remove hard-coded length restrictions
    # This allows user to specify length requirements (e.g., "200 words", "500 characters")
    # BUT: enforce maximum limit of 1500 words per platform to prevent excessive requests
    MAX_WORDS_LIMIT = 1500

    target_words_by_platform = {
        platform: resolve_target_words_for_platform(
            effective_instructions.get("all", ""),
            effective_instructions.get(platform, ""),
            MAX_WORDS_LIMIT,
        )
        for platform in platforms_for_prompt
    }
    combined_lower = combined.lower() if combined else ""
    has_length_instruction = any(keyword in combined_lower for keyword in [
        "word", "words", "character", "characters", "chars",
        "length", "long", "short", "cuvinte", "cuvânt", "cuvintele"
    ]) if combined else False
    has_length_number = bool(re.search(r'\d+\s*(word|words|character|characters|chars|line|lines)', combined_lower)) if combined else False

    if has_length_instruction or has_length_number:
        if ("youtube" in combined_lower or "all" in combined_lower or not any(p in combined_lower for p in ["instagram", "tiktok"])) and not target_words_by_platform.get("youtube"):
            youtube_rules = "   - description: (follow custom instructions for length, max 1500 words)"
        if ("instagram" in combined_lower or "all" in combined_lower) and not target_words_by_platform.get("instagram"):
            instagram_rules = "   - description: (follow custom instructions for length, max 1500 words)"
        if ("tiktok" in combined_lower or "all" in combined_lower) and not target_words_by_platform.get("tiktok"):
            tiktok_rules = "   - description: (follow custom instructions for length, max 1500 words)"

    if target_words_by_platform.get("youtube"):
        youtube_rules = f"   - description: about {target_words_by_platform['youtube']} words (follow custom instructions, max 1500 words)"
        print("✅ Custom instructions specify target words for YouTube")
    if target_words_by_platform.get("instagram"):
        instagram_rules = f"   - description: about {target_words_by_platform['instagram']} words (follow custom instructions, max 1500 words)"
        print("✅ Custom instructions specify target words for Instagram")
    if target_words_by_platform.get("tiktok"):
        tiktok_rules = f"   - description: about {target_words_by_platform['tiktok']} words (follow custom instructions, max 1500 words)"
        print("✅ Custom instructions specify target words for TikTok")

    instagram_wants_long = wants_long_description(resolved_by_platform.get("instagram", {}).get("mergedInstructions", ""))
    tiktok_wants_long = wants_long_description(resolved_by_platform.get("tiktok", {}).get("mergedInstructions", ""))
    if instagram_wants_long and not target_words_by_platform.get("instagram"):
        instagram_rules = "   - description: (follow custom instructions for length, allow longer than typical IG captions)"
        print("✅ Custom instructions request longer IG description - relaxing short caption rule")
    if tiktok_wants_long and not target_words_by_platform.get("tiktok"):
        tiktok_rules = "   - description: (follow custom instructions for length, allow longer than typical TikTok captions)"
        print("✅ Custom instructions request longer TikTok description - relaxing short caption rule")
    
    def build_structured_desc_rule(requested_words: Optional[int] = None) -> str:
        rule = (
            "   - description: Use a structured, multi-paragraph layout with: "
            "1 short intro paragraph (1-3 sentences), blank line, "
            "'Key points / Topics' section with 3-6 bullet points, "
            "optional 'Highlights' section with 2-4 bullets if enough content, "
            "Sources placeholder section if sources are requested. "
            "Use blank lines between sections."
        )
        if requested_words:
            rule += f" Target length: about {requested_words} words."
        return rule

    if wants_structured_description_by_platform.get("youtube"):
        youtube_rules = build_structured_desc_rule(target_words_by_platform.get("youtube"))
        print("✅ Structured description requested for YouTube - enforcing structured layout")
    if wants_structured_description_by_platform.get("instagram"):
        instagram_rules = build_structured_desc_rule(target_words_by_platform.get("instagram"))
        print("✅ Structured description requested for Instagram - enforcing structured layout")
    if wants_structured_description_by_platform.get("tiktok"):
        tiktok_rules = build_structured_desc_rule(target_words_by_platform.get("tiktok"))
        print("✅ Structured description requested for TikTok - enforcing structured layout")

    platform_label_map = {
        "youtube": "YouTube",
        "instagram": "Instagram",
        "tiktok": "TikTok",
    }
    all_instructions_text = effective_instructions.get("all", "")
    output_language_by_platform = {
        platform: resolve_output_language_for_platform(
            all_instructions_text,
            effective_instructions.get(platform, ""),
            settings_language=settings_language,
        )
        for platform in platforms_for_prompt
    }
    language_rule_lines = ["- Output language by platform:"]
    for platform in platforms_for_prompt:
        label = platform_label_map.get(platform, platform.title())
        language_rule_lines.append(f"  - {label}: {output_language_by_platform.get(platform)}")
    language_rule = "\n".join(language_rule_lines)
    language_intro = "You generate social media metadata from a TRANSCRIPT."

    # Build prompt with custom instructions at the top for higher priority
    # Speaker name rule (generic): keep naming accurate and user-controlled.
    # include_speaker_name_effective: True = may include only if in transcript/context; False = never; None = auto (transcript as source of truth).
    if include_speaker_name_effective is False:
        speaker_rule_lines = [
            "You MUST NOT mention any speaker name anywhere (title, description, hashtags, or any other output), even if the transcript contains a name.",
        ]
    elif include_speaker_name_effective is True:
        speaker_rule_lines = [
            "You MAY include the speaker's name only if the name is explicitly present in the transcript or user-provided context.",
            "Never fabricate a speaker name.",
        ]
        if speaker_name_override:
            speaker_rule_lines.append(
                f'User-provided speaker name: "{speaker_name_override}". Use this name if user instructions request it.'
            )
    else:
        # auto / unset: transcript is the only source of truth
        speaker_rule_lines = [
            "Use the transcript as the only source of truth for speaker names.",
            "You MAY mention a speaker name ONLY if the transcript explicitly contains that speaker name.",
            "If the transcript does not contain a speaker name, DO NOT invent or guess one.",
            "If multiple names appear in the transcript and it is unclear who the speaker is, either omit names or use a neutral reference (e.g., 'the speaker')—do not guess.",
        ]
    speaker_rule_lines.append("Hard rule (always): Never fabricate a speaker name. Never use external assumptions.")
    speaker_rule = " ".join(speaker_rule_lines)

    prompt_parts = [
        language_intro,
        "",
        "Hard rules:",
        "- Output MUST be VALID JSON ONLY. No markdown, no commentary.",
        language_rule,
        "- Use the transcript content. Do NOT base the content on the filename.",
        f"- {speaker_rule}",
        f"- Maximum description length: {MAX_WORDS_LIMIT} words per platform (this is a hard limit, do not exceed it).",
    ]
    if combined and combined.strip():
        prompt_parts.append("- Language rule: if no explicit language is requested, follow the language of the user instructions (do NOT default to English).")
        script_hint = detect_script_hint(combined)
        if script_hint:
            prompt_parts.append(f"- Script rule: user instructions are written in {script_hint}. Output MUST use that same language/script.")
    if force_same_description:
        prompt_parts.append("- Use the exact SAME description text for all requested platforms.")
    
    # Add custom instructions FIRST (before default rules) to give them higher priority
    # Make them DIRECT and CLEAR so OpenAI sees them immediately
    if combined and combined.strip():
        prompt_parts.append("")
        prompt_parts.append("=" * 80)
        prompt_parts.append("⚠️⚠️⚠️ CRITICAL: USER CUSTOM INSTRUCTIONS (HIGHEST PRIORITY - READ THIS FIRST) ⚠️⚠️⚠️")
        prompt_parts.append("=" * 80)
        prompt_parts.append("")
        prompt_parts.append("THESE ARE THE USER'S DIRECT INSTRUCTIONS. YOU MUST FOLLOW THEM EXACTLY.")
        prompt_parts.append("THESE INSTRUCTIONS OVERRIDE ALL OTHER RULES BELOW.")
        prompt_parts.append("READ THESE INSTRUCTIONS CAREFULLY AND FOLLOW THEM PRECISELY.")
        prompt_parts.append("")
        prompt_parts.append("USER CUSTOM INSTRUCTIONS:")
        prompt_parts.append("-" * 80)
        prompt_parts.append(instructions_prompt_block.strip())
        prompt_parts.append("-" * 80)
        prompt_parts.append("")
        prompt_parts.append("CRITICAL REMINDERS:")
        prompt_parts.append("- These user instructions are YOUR PRIMARY GUIDANCE.")
        prompt_parts.append("- If user specifies word counts (e.g., '200 words', '1500 words'), target that length (about the requested words).")
        prompt_parts.append("- If user specifies formats, styles, or content requirements, follow them EXACTLY.")
        prompt_parts.append("- Default rules below are SECONDARY - only use them if user instructions don't specify something.")
        prompt_parts.append("- Do NOT compromise, shorten, or modify user requirements.")
        prompt_parts.append("=" * 80)
        prompt_parts.append("")
    
    prompt_parts.append("Targets:")
    platform_specs = [
        ("youtube", "YouTube", "title <= 90 characters", youtube_rules, "hashtags: 12-18"),
        ("instagram", "Instagram", "title/headline <= 80 characters", instagram_rules, "hashtags: 18-28"),
        ("tiktok", "TikTok", "title/hook <= 80 characters", tiktok_rules, "hashtags: 15-25"),
    ]
    index = 1
    for platform_key, label, title_rule, desc_rule, tag_rule in platform_specs:
        if platforms_for_prompt and platform_key not in platforms_for_prompt:
            continue
        prompt_parts.append(f"{index}) {label}:")
        language_for_platform = output_language_by_platform.get(platform_key)
        if language_for_platform:
            prompt_parts.append(f"   - output language: {language_for_platform}")
        prompt_parts.append("   - description must be body text only (no CTA/LINKS/DISCLAIMER).")
        prompt_parts.append("   - do NOT include hashtags in description; put hashtags only in hashtags field.")
        if not wants_structured_description_by_platform.get(platform_key):
            prompt_parts.append("   - do NOT add headings/sections/bullets unless explicitly requested.")
        if not sources_intent_by_platform.get(platform_key):
            prompt_parts.append("   - do NOT add sources/links/citations section unless explicitly requested.")
        merged_instructions = resolved_by_platform.get(platform_key, {}).get("mergedInstructions", "")
        if merged_instructions:
            prompt_parts.append("   - custom instructions (apply in addition to global instructions):")
            for line in merged_instructions.splitlines():
                prompt_parts.append(f"     {line}")
            if platform_key == "instagram" and instagram_wants_long:
                prompt_parts.append(
                    "   - If user asks for detailed/long description, follow that even if longer than typical IG captions."
                )
            if platform_key == "tiktok" and tiktok_wants_long:
                prompt_parts.append(
                    "   - If user asks for detailed/long description, follow that even if longer than typical TikTok captions."
                )
            if sources_intent_by_platform.get(platform_key):
                prompt_parts.append(
                    "   - If user asks for sources, DO NOT invent URLs or citations. "
                    "Append a 'Surse (adaugă manual)' section with placeholders and search keywords."
                )
        prompt_parts.append(f"   - {title_rule}")
        prompt_parts.append(f"   {desc_rule}")
        prompt_parts.append(f"   - {tag_rule}")
        index += 1
    prompt_parts.extend([
        "",
        "Avoid repetitive hashtags. Prefer topic hashtags derived from transcript.",
        "Do NOT use short code/number hashtags (e.g. #C3, #508, #C1A).",
        "If legal/tax codes are relevant, use descriptive tags like #501c3, #Nonprofit, #TaxExempt, #ChurchAndState.",
        "Never invent claims not supported by transcript.",
    ])
    
    prompt_parts.extend([
        "",
        "Return JSON exactly matching this shape (keys required):",
        json.dumps(schema, ensure_ascii=False),
        "",
        "Inputs:",
        f"variant_type = {variant_type}",
        f"include_speaker_name = {'auto' if include_speaker_name_effective is None else str(include_speaker_name_effective).lower()}",
        f"speaker_name_override = {speaker_name_override or 'none'}",
        f"filename_hint = {filename_hint}",
        "",
        "Transcript:",
        transcript,
    ])
    
    prompt = "\n".join(prompt_parts).strip()

    try:
        text = call_openai_proxy(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that generates social media metadata. Always return valid JSON only, no markdown formatting. Follow user instructions EXACTLY, especially those marked as HIGHEST PRIORITY."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"} if "gpt-4" in OPENAI_MODEL or "gpt-3.5" in OPENAI_MODEL else None,
            temperature=0.7,
        ).strip()
    except Exception as e:
        _log_customai_error(e)
        raise ValueError(f"OpenAI proxy error: {str(e)}")

    data = extract_json_from_text(text)
    if not isinstance(data, dict):
        _log_customai_error(ValueError("OpenAI did not return valid JSON"))
        raise ValueError("OpenAI did not return a valid JSON object.")

    platforms = data.get("platforms")
    if not isinstance(platforms, dict):
        _log_customai_error(ValueError("Missing platforms in OpenAI JSON"))
        raise ValueError("Missing 'platforms' dict in OpenAI JSON.")

    platforms_to_process = allowed_platforms if allowed_platforms else ["youtube", "instagram", "tiktok"]
    if force_same_description:
        apply_identical_description(platforms, platforms_to_process)

    def build_expansion_prompt(existing_platforms: Dict[str, Any], targets: Dict[str, int]) -> str:
        lines = [
            "You are given existing JSON metadata. Expand ONLY the description field for the listed platforms.",
            "Keep titles and hashtags EXACTLY the same.",
            "Keep the same output language and formatting rules as specified below.",
            "Description must be body text only (no CTA/LINKS/DISCLAIMER).",
            "Do NOT include hashtags in description; keep hashtags only in the hashtags field.",
            "Do NOT add sources/links/citations unless explicitly requested.",
            "If format=structured, keep the structured layout with sections and bullet points.",
            "",
            "Targets:",
        ]
        for platform_key, target in targets.items():
            label = platform_label_map.get(platform_key, platform_key.title())
            language = output_language_by_platform.get(platform_key, "Match the language used in the user instructions")
            structured_flag = "structured" if wants_structured_description_by_platform.get(platform_key) else "default"
            lines.append(f"- {label}: about {target} words; language={language}; format={structured_flag}")
        lines.extend([
            "",
            "Return JSON exactly matching this shape (keys required):",
            json.dumps(schema, ensure_ascii=False),
            "",
            "Existing JSON:",
            json.dumps({"platforms": existing_platforms}, ensure_ascii=False),
        ])
        return "\n".join(lines).strip()

    retry_targets: Dict[str, int] = {}
    for platform_key in platforms_to_process:
        target_words = target_words_by_platform.get(platform_key)
        if not target_words:
            continue
        desc_text = str((platforms.get(platform_key, {}) or {}).get("description", "")).strip()
        if count_words(desc_text) < int(0.8 * target_words):
            retry_targets[platform_key] = target_words

    if retry_targets:
        print(f"[customAI] retrying description expansion | targets={','.join(retry_targets.keys())}")
        retry_prompt = build_expansion_prompt(platforms, retry_targets)
        try:
            retry_text = call_openai_proxy(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that edits JSON metadata. Always return valid JSON only, no markdown formatting."},
                    {"role": "user", "content": retry_prompt},
                ],
                response_format={"type": "json_object"} if "gpt-4" in OPENAI_MODEL or "gpt-3.5" in OPENAI_MODEL else None,
                temperature=0.6,
            ).strip()
            retry_data = extract_json_from_text(retry_text)
            retry_platforms = retry_data.get("platforms") if isinstance(retry_data, dict) else None
            if isinstance(retry_platforms, dict):
                platforms = retry_platforms
                print("[customAI] retry applied | ok=true")
            else:
                print("[customAI] retry failed | err=invalid JSON shape, keeping original output.")
        except Exception as e:
            err_msg = (str(e) or "unknown")[:50].replace("\n", " ").replace("|", "")
            print(f"[customAI] retry failed | err={err_msg}")

    out: Dict[str, Any] = {
        "platforms": {},
        "model": OPENAI_MODEL,
        "speaker_name_override": speaker_name_override,
    }
    needs_sources_block = any(sources_intent_by_platform.values()) if sources_intent_by_platform else False
    keywords_for_sources = extract_search_keywords(transcript) if needs_sources_block else []
    
    for key in ("youtube", "instagram", "tiktok"):
        # Skip if not in allowed_platforms
        if allowed_platforms and key not in allowed_platforms:
            continue
            
        p = platforms.get(key)
        if not isinstance(p, dict):
            _log_customai_error(ValueError(f"Missing platform: {key}"))
            raise ValueError(f"Missing platform: {key}")

        title = str(p.get("title", "")).strip()
        desc = str(p.get("description", "")).strip()
        tags = p.get("hashtags") or []
        if not isinstance(tags, list):
            tags = []
        tags = norm_hashtags(tags)

        # Remove any block/hashtags leakage from the description to avoid duplication
        blocks = resolved_by_platform.get(key, {}).get("blocks", {}) or {}
        desc = strip_block_text(desc, blocks.get("cta", ""))
        desc = strip_block_text(desc, blocks.get("links", ""))
        desc = strip_block_text(desc, blocks.get("disclaimer", ""))
        desc = _strip_hashtags_from_text(desc)

        if sources_intent_by_platform.get(key):
            allowed_urls = allowed_urls_by_platform.get(key, [])
            desc = strip_unapproved_urls(desc, allowed_urls)
        
        if wants_structured_description_by_platform.get(key):
            desc = format_structured_description(
                description=desc,
                include_sources=bool(sources_intent_by_platform.get(key)),
                source_keywords=keywords_for_sources,
            )
        elif sources_intent_by_platform.get(key):
            desc = ensure_sources_block(desc, keywords_for_sources)

        if include_speaker_name_effective is False:
            title = title.replace(SPEAKER_NAME, "").replace("Dr.", "").strip()
            title = re.sub(r"\s+", " ", title).strip()
            desc = desc.replace(SPEAKER_NAME, "").replace("Dr.", "").strip()
            desc = re.sub(r"\s+", " ", desc).strip()
            # Remove hashtags that clearly refer to the speaker (no speaker names in any output)
            def _tag_is_speaker_name(tag: str) -> bool:
                clean = tag.lstrip("#%").strip()
                if not clean:
                    return True
                sn = SPEAKER_NAME.strip()
                sn_no_space = sn.replace(" ", "")
                return (
                    clean == sn
                    or clean == sn_no_space
                    or clean in ("Dr.", "Dr")
                    or sn in clean
                    or sn_no_space.lower() in clean.lower()
                )
            tags = [t for t in tags if t.strip() and not _tag_is_speaker_name(t)]

        out["platforms"][key] = {"title": title, "description": desc, "hashtags": tags}

    # Output stats (lengths only, no content)
    _yt_len = _ig_len = _tt_len = 0
    _out_parts = []
    for _k in ("youtube", "instagram", "tiktok"):
        _p = out.get("platforms", {}).get(_k) or {}
        _tl = safe_len(_p.get("title"))
        _dl = safe_len(_p.get("description"))
        _tags = _p.get("hashtags") or []
        _tags_len = sum(safe_len(t) for t in _tags)
        _total = _tl + _dl + _tags_len
        if _k == "youtube":
            _yt_len = _total
        elif _k == "instagram":
            _ig_len = _total
        else:
            _tt_len = _total
        _out_parts.append(_p.get("title", "") + _p.get("description", "") + " ".join(_tags))
    _final_len = _yt_len + _ig_len + _tt_len
    _final_hash = short_hash("".join(_out_parts), 8)
    print(f"[customAI] Output stats   | ytLen={_yt_len} igLen={_ig_len} ttLen={_tt_len} finalLen={_final_len} finalHash={_final_hash}")
    _elapsed_ms = int((time.perf_counter() - _t0) * 1000)
    print(f"[customAI] Done           | ms={_elapsed_ms} ok=true")
    return out


# ----------------------------
# EXPORTS PER PLATFORM
# ----------------------------

def export_platforms(final_meta: Dict[str, Any], exports_dir: Path, stem: str, allowed_platforms: List[str] = None) -> None:
    platforms = final_meta.get("platforms") or {}
    if not isinstance(platforms, dict) or not platforms:
        return

    name_map = {"youtube": "YouTube", "instagram": "Instagram", "tiktok": "TikTok"}

    # Filter platforms if allowed_platforms is specified
    platforms_to_export = platforms
    if allowed_platforms:
        platforms_to_export = {k: v for k, v in platforms.items() if k in allowed_platforms}

    for platform, pdata in platforms_to_export.items():
        if not isinstance(pdata, dict):
            continue

        folder_name = name_map.get(platform.lower(), platform)
        pdir = exports_dir / folder_name
        pdir.mkdir(parents=True, exist_ok=True)

        title = (pdata.get("title") or "").strip()
        desc = (pdata.get("description") or "").strip()
        # Normalize hashtags (strip extra #/% and enforce single leading #)
        raw_tags = pdata.get("hashtags") or []
        tags = norm_hashtags(raw_tags)

        write_text(pdir / f"{stem}.title.txt", title)
        write_text(pdir / f"{stem}.description.txt", desc)
        write_text(pdir / f"{stem}.hashtags.txt", " ".join(tags))

        export_json = {
            "platform": platform.lower(),
            "source_video": final_meta.get("source_video"),
            "variant_type": final_meta.get("variant_type"),
            "include_speaker_name": final_meta.get("include_speaker_name"),
            "generated_at": final_meta.get("generated_at"),
            "title": title,
            "description": desc,
            "hashtags": tags,
            "openai_model": final_meta.get("openai_model"),
        }
        save_json(pdir / f"{stem}.json", export_json)


# ----------------------------
# MAIN
# ----------------------------

def parse_args() -> argparse.Namespace:
    # NOTE: The Electron app historically passed a bunch of flags.
    # We accept the important ones and ignore the rest to avoid breaking the UI.
    p = argparse.ArgumentParser(add_help=True)
    p.add_argument("--mode", default=None, help="(ignored) files/folder/default")
    p.add_argument("--files", nargs="*", default=None, help="Explicit list of video files to process")
    p.add_argument("--paths", nargs="*", default=None, help="Alias for --files (used by the app)")
    p.add_argument("--folder", default=None, help="Process all videos in this folder (recursive)")
    p.add_argument("--variant", default=None, help="(ignored) variant hint from UI")
    p.add_argument("--time_zone", default=None, help="(ignored) UI scheduling")
    p.add_argument("--videos_per_day", default=None, help="(ignored) UI scheduling")
    p.add_argument("--times", default=None, help="(ignored) UI scheduling")
    p.add_argument("--publish_mode", default=None, help="(ignored) UI scheduling")
    p.add_argument("--no-openai", action="store_true", help="Skip OpenAI metadata generation")
    p.add_argument("--device", choices=["cuda", "cpu"], default=None, help="Force compute device for Whisper (cuda|cpu)")
    p.add_argument("--platforms", nargs="*", default=None, help="Generate metadata only for specified platforms (youtube, instagram, tiktok)")

    args, unknown = p.parse_known_args()
    if unknown:
        # Do not fail on unknown flags – just log them.
        print(f"[WARN] Ignoring unknown args: {unknown}")

    # Unify file lists
    if not args.files and args.paths:
        args.files = args.paths
    return args


def resolve_videos(args: argparse.Namespace) -> List[Path]:
    # 1) Explicit files (from app)
    if args.files:
        vids: List[Path] = []
        for f in args.files:
            fp = Path(f)
            if fp.is_file() and fp.suffix.lower() in VIDEO_EXTS:
                vids.append(fp)
        # de-dup preserving order
        seen = set()
        out: List[Path] = []
        for v in vids:
            k = str(v.resolve()).lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(v)
        return out

    # 2) Folder scan
    if args.folder:
        d = Path(args.folder)
        if d.exists() and d.is_dir():
            return list_videos_recursive(d)
        return []

    # 3) Optional fallback env var
    if VIDEOS_FOLDER:
        d = Path(VIDEOS_FOLDER)
        if d.exists() and d.is_dir():
            return sorted([p for p in d.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_EXTS])

    return []


def main() -> int:
    if KMP_DUPLICATE_LIB_OK:
        os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    _add_dll_dirs_for_python_root()
    _add_dll_dirs_for_python_root()

    args = parse_args()
    ensure_dirs()

    # Quick ffmpeg presence check for clearer diagnostics if the bundled binary is missing.
    try:
        subprocess.run([FFMPEG_BIN, "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except FileNotFoundError:
        print("❌ ffmpeg was not found. If you are running ClipCast, the installation may be corrupted (missing internal ffmpeg binary).")
        return 3
    except Exception:
        # Non-fatal: the actual extract step will surface detailed errors if ffmpeg is broken.
        pass

    # Parse allowed platforms
    allowed_platforms = None
    if args.platforms:
        allowed_platforms = [p.lower() for p in args.platforms if p.lower() in ["youtube", "instagram", "tiktok"]]
        if allowed_platforms:
            print(f"🎯 Generating metadata only for platforms: {', '.join(allowed_platforms)}")

    videos = resolve_videos(args)

    mode = "files" if args.files else ("folder" if args.folder else ("env_folder" if VIDEOS_FOLDER else "none"))
    print(f"📌 Mode: {mode}")
    print(f"📁 Outputs: {OUTPUTS_DIR}")

    if not videos:
        print("❌ No videos to process. Provide --files or --folder (or set VIDEOS_FOLDER env var).")
        return 2

    print(f"🎞️  Videos selected: {len(videos)}")

    run_id = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    report_path = REPORTS_DIR / f"report_{run_id}.txt"
    csv_path = REPORTS_DIR / f"report_{run_id}.csv"

    counters = {"found": len(videos), "processed": 0, "skipped": 0, "errors": 0}
    report_lines: List[str] = [
        f"RUN: {run_id}",
        f"MODE: {mode}",
        f"FOUND: {len(videos)}",
        "",
    ]

    csv_rows: List[List[str]] = []
    csv_rows.append(["video", "action", "variant_type", "include_speaker_name", "metadata_file", "error"])

    model = load_whisper_model(args.device)

    for v in videos:
        stem = stem_for_path(v)

        mp3_path = AUDIO_DIR / f"{stem}.mp3"
        transcript_path = TRANSCRIPTS_DIR / f"{stem}.txt"
        meta_path = METADATA_DIR / f"{stem}.json"

        variant_type = detect_variant_type(v)
        include_name = should_include_speaker_name(variant_type)

        print(f"\n🎧 Processing: {v.name}")

        try:
            # 1) Audio
            run_ffmpeg_extract_mp3(v, mp3_path)

            # 2) Transcript
            if not transcript_path.exists() or transcript_path.stat().st_size < 10:
                try:
                    text = transcribe_to_text(model, mp3_path)
                except Exception as exc:
                    if CURRENT_WHISPER_DEVICE == "cuda" and _is_gpu_error(exc):
                        print(f"[compute] GPU failure detail: {type(exc).__name__}: {exc}")
                        print("[compute] GPU failed for Whisper, reloading on CPU (int8) and retrying")
                        model = load_whisper_model("cpu")
                        text = transcribe_to_text(model, mp3_path)
                    else:
                        raise
                write_text(transcript_path, text)
            else:
                text = read_text(transcript_path)

            text = (text or "").strip()
            if len(text) < MIN_TRANSCRIPT_CHARS:
                raise RuntimeError(
                    f"Transcript is too short ({len(text)} chars). "
                    "Whisper likely failed (missing model, bad ffmpeg, or silent audio)."
                )

            # 3) Metadata
            final: Dict[str, Any]
            if args.no_openai:
                action = "SKIP_OPENAI"
                final = {
                    "source_video": str(v),
                    "variant_type": variant_type,
                    "include_speaker_name": bool(include_name),
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                    "platforms": {},
                    "openai_model": OPENAI_MODEL,
                    "note": "OpenAI skipped by --no-openai",
                }
            else:
                # Check if metadata file exists and if we need to regenerate
                should_regenerate = True
                existing_meta = None
                
                if meta_path.exists() and meta_path.stat().st_size > 10:
                    existing_meta = load_json(meta_path)
                    # If allowed_platforms is specified, check if all requested platforms exist
                    if allowed_platforms and existing_meta.get("platforms"):
                        existing_platforms = set(existing_meta.get("platforms", {}).keys())
                        requested_platforms = set(allowed_platforms)
                        missing_platforms = requested_platforms - existing_platforms
                        if not missing_platforms:
                            # All requested platforms exist, skip regeneration
                            should_regenerate = False
                        else:
                            print(f"🔄 Regenerating metadata for missing platforms: {', '.join(missing_platforms)}")
                    elif not allowed_platforms:
                        # No specific platforms requested, check if ALL platforms exist
                        # If any platform is missing, we need to regenerate
                        platforms_dict = existing_meta.get("platforms", {})
                        if platforms_dict:
                            # Check if all three platforms (youtube, instagram, tiktok) exist
                            required_platforms = {"youtube", "instagram", "tiktok"}
                            existing_platforms = set(platforms_dict.keys())
                            missing_platforms = required_platforms - existing_platforms
                            if missing_platforms:
                                print(f"🔄 Regenerating metadata for missing platforms: {', '.join(missing_platforms)}")
                                should_regenerate = True
                            else:
                                # All platforms exist, skip regeneration
                                should_regenerate = False
                        else:
                            # No platforms at all, need to regenerate
                            should_regenerate = True
                
                if not should_regenerate and existing_meta:
                    final = normalize_metadata_hashtags(existing_meta)
                    action = "SKIP_OPENAI"
                    print("⏩ Metadata exists, skipping OpenAI")
                    try:
                        save_json(meta_path, final)
                    except Exception as e:
                        print(f"⚠️  Failed to normalize hashtags in metadata: {e}")
                else:
                    try:
                        user_data_dir_local = os.getenv("APP_USER_DATA")
                        settings = load_metadata_settings(user_data_dir_local) if user_data_dir_local else {
                            "customInstructions": create_empty_platform_map(),
                            "descriptionTemplate": create_empty_platform_map(),
                            "blocks": normalize_blocks({}),
                        }
                        platforms_to_generate = allowed_platforms if allowed_platforms else ["youtube", "instagram", "tiktok"]
                        split_generation = should_split_generation(settings, platforms_to_generate)
                        instruction_map = build_platform_instruction_map(settings, platforms_to_generate)
                        combined_instructions = "\n".join(instruction_map.values())
                        speaker_name_override = extract_speaker_name_from_instructions(combined_instructions)
                        if speaker_name_override:
                            include_name = True
                        force_same_description = wants_identical_description(combined_instructions)

                        if split_generation:
                            print("[customAI] per-platform overrides | generating separately")
                            per_platform: Dict[str, Any] = {}
                            model_used = None
                            for platform_key in platforms_to_generate:
                                meta_platform = openai_generate_metadata(
                                    transcript=text,
                                    filename_hint=v.name,
                                    include_speaker_name=include_name,
                                    speaker_name_override=speaker_name_override,
                                    variant_type=variant_type,
                                    allowed_platforms=[platform_key],
                                )
                                platform_data = meta_platform.get("platforms", {}).get(platform_key)
                                if isinstance(platform_data, dict):
                                    per_platform[platform_key] = platform_data
                                if not model_used:
                                    model_used = meta_platform.get("model")
                            if force_same_description and len(per_platform) > 1:
                                apply_identical_description(per_platform, platforms_to_generate)
                            meta = {
                                "platforms": per_platform,
                                "model": model_used or OPENAI_MODEL,
                                "speaker_name_override": speaker_name_override,
                            }
                        else:
                            meta = openai_generate_metadata(
                                transcript=text,
                                filename_hint=v.name,
                                include_speaker_name=include_name,
                                speaker_name_override=speaker_name_override,
                                variant_type=variant_type,
                                allowed_platforms=allowed_platforms,
                            )
                            if force_same_description and len(platforms_to_generate) > 1:
                                apply_identical_description(meta.get("platforms", {}), platforms_to_generate)

                        # Merge with existing metadata if regenerating specific platforms
                        if existing_meta and allowed_platforms:
                            # Start with existing platforms
                            merged_platforms = existing_meta.get("platforms", {}).copy()
                            # Update/add only the requested platforms
                            for platform, platform_data in meta["platforms"].items():
                                merged_platforms[platform] = platform_data
                            final_platforms = merged_platforms
                        else:
                            # Use all generated platforms (no existing metadata or regenerating all)
                            final_platforms = meta["platforms"]

                        final = {
                            "source_video": str(v),
                            "variant_type": variant_type,
                            "include_speaker_name": bool(include_name),
                            "speaker_name_controlled": SPEAKER_NAME,
                            "speaker_name_override": meta.get("speaker_name_override"),
                            "generated_at": datetime.now().isoformat(timespec="seconds"),
                            "platforms": final_platforms,
                            "openai_model": meta.get("model", OPENAI_MODEL),
                            "transcript_chars": len(text),
                        }
                        final = normalize_metadata_hashtags(final)
                        save_json(meta_path, final)
                        action = "OK"
                        print("✅ Metadata saved")
                    except Exception as e:
                        print(f"❌ OpenAI error: {e}")
                        final = {
                            "source_video": str(v),
                            "variant_type": variant_type,
                            "include_speaker_name": bool(include_name),
                            "generated_at": datetime.now().isoformat(timespec="seconds"),
                            "platforms": {},
                            "openai_model": OPENAI_MODEL,
                            "note": f"OpenAI error: {str(e)}",
                        }
                        action = "ERROR"

            # 4) Exports
            export_platforms(final_meta=final, exports_dir=EXPORTS_DIR, stem=stem, allowed_platforms=allowed_platforms)
            print("📦 Platform exports saved")

            if action == "SKIP_OPENAI":
                counters["skipped"] += 1
            else:
                counters["processed"] += 1

            report_lines.append(f"{action}: {v.name} -> {meta_path.name}")
            csv_rows.append([v.name, action, variant_type, str(include_name), meta_path.name, ""])
            print(f"PIPELINE_FILE_DONE|{action}|{str(v)}")

        except Exception as e:
            counters["errors"] += 1
            err = str(e)
            print(f"❌ ERROR: {err}")
            report_lines.append(f"ERROR: {v.name} -> {err}")
            csv_rows.append([v.name, "ERROR", variant_type, str(include_name), meta_path.name, err])
            print(f"PIPELINE_FILE_DONE|ERROR|{str(v)}")

    report_lines += [
        "",
        "SUMMARY",
        f"FOUND: {counters['found']}",
        f"PROCESSED: {counters['processed']}",
        f"SKIPPED: {counters['skipped']}",
        f"ERRORS: {counters['errors']}",
    ]

    write_text(report_path, "\n".join(report_lines))

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerows(csv_rows)

    print(f"\n🧾 Report saved: {report_path}")
    print(f"📄 CSV saved: {csv_path}")
    print("\n✅ DONE")
    _release_whisper_model(model)
    model = None
    return 0 if counters["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
