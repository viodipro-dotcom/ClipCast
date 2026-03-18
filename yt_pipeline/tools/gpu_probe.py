"""GPU probe using only nvidia-smi. Does not import PyTorch or touch CUDA, so it never initializes the GPU."""
from __future__ import annotations

import json
import platform
import subprocess
import sys
from typing import Any, Dict, Optional


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _probe_nvidia_smi(info: Dict[str, Any]) -> None:
    """Detect GPU using only nvidia-smi. No PyTorch/CUDA - no GPU initialization."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return

    if result.returncode != 0:
        return

    lines = [ln.strip() for ln in (result.stdout or "").strip().splitlines() if ln.strip()]
    if not lines:
        return

    info["gpu_count"] = len(lines)
    info["cuda_available"] = True

    # First GPU: name and VRAM
    first = lines[0]
    parts = [p.strip() for p in first.split(",")]
    if parts:
        info["gpu_name"] = parts[0]
        if len(parts) > 1:
            mem_str = parts[1].lower().replace("mib", "").strip()
            vram_mb = _safe_int(mem_str, 0)
            if vram_mb > 0:
                info["vram_total_mb"] = vram_mb


def main() -> int:
    error: Optional[str] = None

    info: Dict[str, Any] = {
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "platform": platform.platform(),
        "torch_installed": None,
        "torch_version": None,
        "cuda_available": False,
        "cuda_version": None,
        "gpu_count": 0,
        "gpu_name": None,
        "vram_total_mb": 0,
        "error": None,
    }

    try:
        _probe_nvidia_smi(info)
    except Exception as exc:
        error = f"probe_failed: {type(exc).__name__}: {exc}"

    if error:
        info["error"] = error

    try:
        print(json.dumps(info, ensure_ascii=False))
    except Exception as exc:
        fallback = {
            "python": info.get("python"),
            "platform": info.get("platform"),
            "torch_installed": None,
            "torch_version": None,
            "cuda_available": False,
            "cuda_version": None,
            "gpu_count": 0,
            "gpu_name": None,
            "vram_total_mb": 0,
            "error": f"json_failed: {type(exc).__name__}: {exc}",
        }
        print(json.dumps(fallback, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
