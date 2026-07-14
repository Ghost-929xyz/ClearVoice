import numpy as np


def estimate_snr(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    frame_size = 512
    usable = audio[: len(audio) - (len(audio) % frame_size)]
    if usable.size == 0:
        usable = audio
        frame_size = len(audio)
    frames = usable.reshape(-1, frame_size)
    energies = np.mean(frames**2, axis=1) + 1e-12
    noise = float(np.percentile(energies, 20))
    speech = float(np.percentile(energies, 85))
    signal = max(speech - noise, 1e-12)
    return round(10.0 * np.log10(signal / noise), 2)


def rms(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return round(float(np.sqrt(np.mean(audio**2))), 5)


def waveform_peaks(audio: np.ndarray, buckets: int = 96) -> list[float]:
    if audio.size == 0:
        return []
    chunks = np.array_split(np.abs(audio), buckets)
    peaks = [float(np.max(chunk)) if chunk.size else 0.0 for chunk in chunks]
    top = max(peaks) if peaks else 0.0
    if top <= 1e-9:
        return [0.0 for _ in peaks]
    return [round(value / top, 3) for value in peaks]


def noise_reduction_ratio(before: np.ndarray, after: np.ndarray) -> str:
    before_floor = _noise_floor(before)
    after_floor = _noise_floor(after)
    if before_floor <= 1e-12:
        return "0%"
    ratio = max(0.0, min(0.99, 1.0 - after_floor / before_floor))
    return f"{round(ratio * 100)}%"


def _noise_floor(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    frame_size = 512
    usable = audio[: len(audio) - (len(audio) % frame_size)]
    if usable.size == 0:
        return float(np.mean(audio**2))
    frames = usable.reshape(-1, frame_size)
    energies = np.mean(frames**2, axis=1) + 1e-12
    return float(np.percentile(energies, 20))
