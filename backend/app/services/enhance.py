import shutil
import subprocess
import sys
import importlib.util
import os
from pathlib import Path

import numpy as np
import soundfile as sf


class EnhancementError(RuntimeError):
    pass


def enhance_speech_file(input_wav: Path, output_wav: Path) -> None:
    """Enhance speech with DeepFilterNet and write a browser-playable WAV file."""
    if not _deepfilternet_available():
        raise EnhancementError("未安装 DeepFilterNet。请确认后端使用 .venv 启动，并在 backend 目录执行：python -m pip install -r requirements.txt")

    output_wav.parent.mkdir(parents=True, exist_ok=True)
    work_dir = output_wav.parent / "deepfilternet"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        "-m",
        "df.enhance",
        str(input_wav),
        "--output-dir",
        str(work_dir),
        "--atten-lim",
        "20",
    ]

    try:
        env = os.environ.copy()
        # DeepFilterNet can crash on newer GPUs when the installed PyTorch wheel
        # lacks kernels for that architecture. Keep enhancement stable on CPU.
        env["CUDA_VISIBLE_DEVICES"] = "-1"
        subprocess.run(command, check=True, capture_output=True, text=True, env=env)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr or exc.stdout or str(exc)
        if "No module named 'torch'" in detail or "No module named 'torchaudio'" in detail:
            raise EnhancementError("DeepFilterNet 依赖不完整，缺少 torch/torchaudio。请使用 .venv 安装 CUDA 版 PyTorch 和 torchaudio。") from exc
        raise EnhancementError(f"DeepFilterNet 增强失败：{detail[-1500:]}") from exc

    enhanced = _find_enhanced_file(work_dir, input_wav)
    if not enhanced:
        raise EnhancementError("DeepFilterNet 未生成增强音频文件")
    _write_enhanced_output(enhanced, output_wav)


def _find_enhanced_file(work_dir: Path, input_wav: Path) -> Path | None:
    candidates = list(work_dir.rglob("*.wav"))
    if not candidates:
        return None

    input_name = input_wav.stem.lower()
    for candidate in candidates:
        name = candidate.stem.lower()
        if input_name in name or "enhanced" in name or "df" in name:
            return candidate
    return candidates[0]


def _deepfilternet_available() -> bool:
    return importlib.util.find_spec("df.enhance") is not None


def _write_enhanced_output(enhanced_wav: Path, output_wav: Path) -> None:
    enhanced, enhanced_sr = sf.read(enhanced_wav, dtype="float32")
    enhanced = _to_mono(enhanced)
    if len(enhanced) == 0:
        raise EnhancementError("增强音频为空，无法输出")

    peak = float(np.max(np.abs(enhanced)))
    if peak > 0.98:
        enhanced = enhanced / peak * 0.98
    sf.write(output_wav, enhanced, enhanced_sr, subtype="PCM_16")


def _to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio
    return audio.mean(axis=1)
