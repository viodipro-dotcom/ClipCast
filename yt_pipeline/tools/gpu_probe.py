"""GPU probe for adapter inventory (no CUDA init)."""
from __future__ import annotations

import json
import platform
import subprocess
import os
import sys
from typing import Any, Dict, List, Optional


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _run_cmd(args: List[str], timeout: int = 10) -> Optional[subprocess.CompletedProcess]:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except Exception:
        return None


def _parse_vendor(name: str, pnp_id: str = "") -> str:
    n = (name or "").lower()
    p = (pnp_id or "").upper()
    if "VEN_10DE" in p or "nvidia" in n:
        return "nvidia"
    if "VEN_8086" in p or "intel" in n:
        return "intel"
    if "VEN_1002" in p or "VEN_1022" in p or "amd" in n or "radeon" in n:
        return "amd"
    return "unknown"


def _find_powershell() -> str:
    system_root = os.environ.get("SystemRoot") or os.environ.get("WINDIR") or "C:\\Windows"
    candidates = [
        os.path.join(system_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        os.path.join(system_root, "System32", "WindowsPowerShell", "v1.0", "powershell"),
        "powershell.exe",
        "powershell",
    ]
    for candidate in candidates:
        if os.path.isabs(candidate):
            if os.path.exists(candidate):
                return candidate
        else:
            return candidate
    return "powershell"


def _find_nvidia_smi() -> str:
    system_root = os.environ.get("SystemRoot") or os.environ.get("WINDIR") or "C:\\Windows"
    program_files = os.environ.get("ProgramFiles") or "C:\\Program Files"
    program_files_x86 = os.environ.get("ProgramFiles(x86)") or "C:\\Program Files (x86)"
    candidates = [
        os.path.join(system_root, "System32", "nvidia-smi.exe"),
        os.path.join(program_files, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
        os.path.join(program_files_x86, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
        "nvidia-smi.exe",
        "nvidia-smi",
    ]
    for candidate in candidates:
        if os.path.isabs(candidate):
            if os.path.exists(candidate):
                return candidate
        else:
            return candidate
    return "nvidia-smi"


def _probe_windows_adapters(info: Dict[str, Any]) -> None:
    """Use PowerShell CIM query to list adapters on Windows."""
    ps_exe = _find_powershell()
    ps = [
        ps_exe,
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | "
        "Select-Object Name,AdapterRAM,PNPDeviceID,DriverVersion | "
        "ConvertTo-Json -Compress",
    ]
    result = _run_cmd(ps, timeout=10)
    if not result or result.returncode != 0 or not (result.stdout or "").strip():
        return
    try:
        raw = json.loads(result.stdout)
    except Exception:
        return
    items = raw if isinstance(raw, list) else [raw]
    adapters: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("Name") or "").strip()
        pnp = str(item.get("PNPDeviceID") or "").strip()
        vram_bytes = _safe_int(item.get("AdapterRAM"), 0)
        vram_mb = int(vram_bytes / (1024 * 1024)) if vram_bytes > 0 else 0
        vendor = _parse_vendor(name, pnp)
        adapters.append(
            {
                "name": name or None,
                "vendor": vendor,
                "vram_mb": vram_mb,
                "pnp_device_id": pnp or None,
                "driver_version": str(item.get("DriverVersion") or "") or None,
                "is_nvidia": vendor == "nvidia",
            }
        )
    if adapters:
        info["adapters"] = adapters


def _probe_nvidia_smi(info: Dict[str, Any]) -> None:
    """Detect NVIDIA GPUs using nvidia-smi (no CUDA init)."""
    try:
        nvidia_smi = _find_nvidia_smi()
        result = _run_cmd(
            [
                nvidia_smi,
                "--query-gpu=name,memory.total,driver_version,compute_cap",
                "--format=csv,noheader",
            ],
            timeout=10,
        )
    except Exception:
        return

    if not result or result.returncode != 0:
        return

    lines = [ln.strip() for ln in (result.stdout or "").strip().splitlines() if ln.strip()]
    if not lines:
        return

    gpus: List[Dict[str, Any]] = []
    for line in lines:
        parts = [p.strip() for p in line.split(",")]
        name = parts[0] if parts else ""
        mem = parts[1] if len(parts) > 1 else ""
        driver = parts[2] if len(parts) > 2 else ""
        compute = parts[3] if len(parts) > 3 else ""
        mem_mb = _safe_int(mem.lower().replace("mib", "").strip(), 0)
        gpus.append(
            {
                "name": name or None,
                "vram_total_mb": mem_mb,
                "driver_version": driver or None,
                "compute_capability": compute or None,
            }
        )
    if gpus:
        info["nvidia_gpus"] = gpus
        info["nvidia_present"] = True
        info["gpu_count"] = len(gpus)
        info["gpu_name"] = gpus[0].get("name")
        info["vram_total_mb"] = gpus[0].get("vram_total_mb") or 0


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
        "adapters": [],
        "nvidia_present": False,
        "nvidia_gpus": [],
        "error": None,
    }

    try:
        if sys.platform == "win32":
            _probe_windows_adapters(info)
        _probe_nvidia_smi(info)
    except Exception as exc:
        error = f"probe_failed: {type(exc).__name__}: {exc}"

    if error:
        info["error"] = error

    # Mark CUDA as "candidate" only if NVIDIA is present (real usability is smoke-tested in Electron)
    if info.get("nvidia_present") is True:
        info["cuda_available"] = True

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
            "adapters": [],
            "nvidia_present": False,
            "nvidia_gpus": [],
            "error": f"json_failed: {type(exc).__name__}: {exc}",
        }
        print(json.dumps(fallback, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
