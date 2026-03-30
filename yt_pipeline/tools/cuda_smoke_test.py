"""CUDA smoke test using bundled runtime (ctranslate2)."""
from __future__ import annotations

import ctypes
import importlib.util
import json
import os
import platform
import sys
import time
from typing import Any, Dict, List, Optional, Tuple


def _classify_error(message: str) -> str:
    msg = (message or "").lower()
    if "cudnn" in msg:
        return "missing_cudnn"
    if "cublas" in msg:
        return "missing_cublas"
    if "cudart" in msg:
        return "missing_cudart"
    if "dll" in msg:
        return "missing_dll"
    if "no cuda" in msg or "cuda not available" in msg:
        return "cuda_unavailable"
    return "cuda_probe_failed"


def _safe_list(value: Any) -> List[str]:
    try:
        return list(value) if value else []
    except Exception:
        return []


def main() -> int:
    started = time.time()
    result: Dict[str, Any] = {
        "ok": False,
        "error": None,
        "reason": None,
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "platform": platform.platform(),
        "ctranslate2_version": None,
        "cuda_device_count": 0,
        "supported_compute_types": [],
        "dll_check": {
            "status": "skipped",
            "missing": [],
            "required": [],
            "optional_missing": [],
        },
        "inference_test": "skipped",
        "inference_error": None,
        "inference_model": None,
        "elapsed_ms": 0,
    }

    try:
        _add_dll_dirs_for_python_root()
        _maybe_fix_openmp_conflict()
        import ctranslate2  # type: ignore

        missing_required, missing_optional = _check_cuda_dlls()
        result["dll_check"]["required"] = ["cublas64_12.dll", "cublasLt64_12.dll", "cudart64_12.dll"]
        result["dll_check"]["missing"] = missing_required
        result["dll_check"]["optional_missing"] = missing_optional
        result["dll_check"]["status"] = "failed" if missing_required else "passed"
        if missing_required:
            result["error"] = f"Missing CUDA DLL(s): {', '.join(missing_required)}"
            result["reason"] = "missing_cuda_dll"
            return _print_and_exit(result, started)

        result["ctranslate2_version"] = getattr(ctranslate2, "__version__", None)
        count = int(ctranslate2.get_cuda_device_count() or 0)
        result["cuda_device_count"] = count
        if count <= 0:
            result["reason"] = "no_cuda_device"
            return _print_and_exit(result, started)

        supported = _safe_list(ctranslate2.get_supported_compute_types("cuda"))
        result["supported_compute_types"] = supported
        if "float16" not in [s.lower() for s in supported]:
            result["reason"] = "cuda_no_float16"
            return _print_and_exit(result, started)

        result["ok"] = True
        result["reason"] = "ok"
        _maybe_run_inference(result)
        return _print_and_exit(result, started)
    except Exception as exc:
        msg = f"{type(exc).__name__}: {exc}"
        result["error"] = msg
        result["reason"] = _classify_error(msg)
        return _print_and_exit(result, started)


def _print_and_exit(payload: Dict[str, Any], started: float) -> int:
    payload["elapsed_ms"] = int((time.time() - started) * 1000)
    try:
        print(json.dumps(payload, ensure_ascii=False))
    except Exception:
        print(json.dumps({"ok": False, "error": "json_failed", "reason": "json_failed"}))
    return 0


def _check_cuda_dlls() -> tuple[List[str], List[str]]:
    required = ["cublas64_12.dll", "cublasLt64_12.dll", "cudart64_12.dll"]
    optional = ["cudnn64_8.dll"]
    missing_required: List[str] = []
    missing_optional: List[str] = []
    search_dirs = _python_dll_search_dirs()
    for dll in required:
        if not _try_load_dll(dll, search_dirs):
            missing_required.append(dll)
    for dll in optional:
        if not _try_load_dll(dll, search_dirs):
            missing_optional.append(dll)
    return missing_required, missing_optional


def _try_load_dll(dll_name: str, search_dirs: List[str]) -> bool:
    for directory in search_dirs:
        candidate = os.path.join(directory, dll_name)
        if os.path.isfile(candidate):
            try:
                ctypes.CDLL(candidate)
                return True
            except Exception:
                continue
    try:
        ctypes.CDLL(dll_name)
        return True
    except Exception:
        return False


def _python_dll_search_dirs() -> List[str]:
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
    return [d for d in dirs if d and os.path.isdir(d)]


def _add_dll_dirs_for_python_root() -> None:
    if not hasattr(os, "add_dll_directory"):
        return
    for directory in _python_dll_search_dirs():
        try:
            os.add_dll_directory(directory)
        except Exception:
            pass


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


def _maybe_run_inference(result: Dict[str, Any]) -> None:
    model_name = (os.getenv("WHISPER_MODEL_NAME", "") or "").strip() or "medium"
    result["inference_model"] = model_name
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        result["inference_test"] = "skipped"
        result["inference_error"] = f"numpy_missing: {exc}"
        return

    try:
        from faster_whisper import WhisperModel  # type: ignore
        model = WhisperModel(
            model_name,
            device="cuda",
            compute_type="float16",
            local_files_only=True,
        )
    except Exception as exc:
        msg = f"{type(exc).__name__}: {exc}"
        msg_lower = msg.lower()
        if "local files only" in msg_lower or "localentrynotfounderror" in msg_lower:
            result["inference_test"] = "skipped"
            result["inference_error"] = "model_missing_local_cache"
            return
        result["inference_test"] = "failed"
        result["inference_error"] = msg
        result["ok"] = False
        result["reason"] = "inference_failed"
        return

    try:
        audio = np.zeros(4000, dtype=np.float32)
        segments, _info = model.transcribe(
            audio,
            language="en",
            beam_size=1,
            best_of=1,
            temperature=0.0,
            vad_filter=False,
            without_timestamps=True,
        )
        try:
            next(iter(segments), None)
        except Exception:
            # force iteration
            for _ in segments:
                break
        result["inference_test"] = "passed"
        result["inference_error"] = None
    except Exception as exc:
        msg = f"{type(exc).__name__}: {exc}"
        result["inference_test"] = "failed"
        result["inference_error"] = msg
        result["ok"] = False
        result["reason"] = "inference_failed"


if __name__ == "__main__":
    raise SystemExit(main())
