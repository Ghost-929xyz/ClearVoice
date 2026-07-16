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


MIN_VOICE_PRESERVE_MIX = 0.16
MAX_VOICE_PRESERVE_MIX = 0.42
MIN_RMS_RATIO = 0.55


def enhance_speech_file(input_wav: Path, output_wav: Path, atten_lim: int = 20) -> None:
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
        str(atten_lim),
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
    _write_enhanced_output(input_wav, enhanced, output_wav, atten_lim=atten_lim)


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


def _write_enhanced_output(input_wav: Path, enhanced_wav: Path, output_wav: Path, atten_lim: int) -> None:
    original, original_sr = sf.read(input_wav, dtype="float32")
    enhanced, enhanced_sr = sf.read(enhanced_wav, dtype="float32")
    original = _to_mono(original)
    enhanced = _to_mono(enhanced)
    if len(enhanced) == 0:
        raise EnhancementError("增强音频为空，无法输出")

    if len(original) > 0:
        if original_sr != enhanced_sr:
            original = _resample_linear(original, original_sr, enhanced_sr)
        original, enhanced = _align_pair(original, enhanced)
        enhanced = _preserve_voice_energy(original, enhanced, atten_lim)

    peak = float(np.max(np.abs(enhanced)))
    if peak > 0.98:
        enhanced = enhanced / peak * 0.98
    sf.write(output_wav, enhanced, enhanced_sr, subtype="PCM_16")


def _to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio
    return audio.mean(axis=1)


def _align_pair(original: np.ndarray, enhanced: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    length = min(len(original), len(enhanced))
    if length <= 0:
        return original[:0], enhanced[:0]
    return original[:length], enhanced[:length]


def _resample_linear(audio: np.ndarray, source_sr: int, target_sr: int) -> np.ndarray:
    if source_sr == target_sr or audio.size == 0:
        return audio
    duration = audio.size / float(source_sr)
    target_size = max(1, int(round(duration * target_sr)))
    source_x = np.linspace(0.0, duration, num=audio.size, endpoint=False)
    target_x = np.linspace(0.0, duration, num=target_size, endpoint=False)
    return np.interp(target_x, source_x, audio).astype("float32")


def _preserve_voice_energy(original: np.ndarray, enhanced: np.ndarray, atten_lim: int) -> np.ndarray:
    original_rms = _rms(original)
    enhanced_rms = _rms(enhanced)
    if original_rms <= 1e-6:
        return enhanced

    strength = max(0, min(100, atten_lim)) / 100.0
    dry_mix = MIN_VOICE_PRESERVE_MIX + (MAX_VOICE_PRESERVE_MIX - MIN_VOICE_PRESERVE_MIX) * strength
    if enhanced_rms < original_rms * MIN_RMS_RATIO:
        dry_mix = max(dry_mix, MAX_VOICE_PRESERVE_MIX)

    protected = enhanced * (1.0 - dry_mix) + original * dry_mix
    protected_rms = _rms(protected)
    minimum_rms = original_rms * MIN_RMS_RATIO
    if 1e-6 < protected_rms < minimum_rms:
        protected = protected * (minimum_rms / protected_rms)
    return protected.astype("float32")


def _rms(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
