import numpy as np


def enhance_speech(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Lightweight speech enhancement that works without model downloads."""
    if audio.size == 0:
        return audio

    filtered = _fft_bandpass(audio, sample_rate, low=80.0, high=7200.0)
    denoised = _moving_average_noise_reduction(filtered)
    gate = _soft_noise_gate(denoised)
    enhanced = denoised * gate
    return _normalize(enhanced)


def _fft_bandpass(audio: np.ndarray, sample_rate: int, low: float, high: float) -> np.ndarray:
    freqs = np.fft.rfftfreq(len(audio), d=1.0 / sample_rate)
    spectrum = np.fft.rfft(audio)
    mask = (freqs >= low) & (freqs <= min(high, sample_rate / 2.0 - 1.0))
    spectrum *= mask
    return np.fft.irfft(spectrum, n=len(audio)).astype(np.float32)


def _moving_average_noise_reduction(audio: np.ndarray) -> np.ndarray:
    if len(audio) < 9:
        return audio.astype(np.float32)
    kernel = np.ones(5, dtype=np.float32) / 5.0
    smoothed = np.convolve(audio, kernel, mode="same")
    return (0.78 * audio + 0.22 * smoothed).astype(np.float32)


def _soft_noise_gate(audio: np.ndarray) -> np.ndarray:
    frame = 512
    if len(audio) < frame:
        return np.ones_like(audio)
    padded = np.pad(audio, (0, frame - len(audio) % frame))
    frames = padded.reshape(-1, frame)
    rms = np.sqrt(np.mean(frames**2, axis=1) + 1e-10)
    floor = np.percentile(rms, 25)
    threshold = max(floor * 1.8, 1e-4)
    frame_gate = np.clip((rms - floor) / (threshold - floor + 1e-6), 0.18, 1.0)
    frame_gate = _smooth_gate(frame_gate)
    gate = np.repeat(frame_gate, frame)[: len(padded)]
    return gate[: len(audio)].astype(np.float32)


def _smooth_gate(gate: np.ndarray) -> np.ndarray:
    if len(gate) < 5:
        return gate
    padded = np.pad(gate, (2, 2), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, 5)
    return np.median(windows, axis=1)


def _normalize(audio: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(audio)))
    if peak < 1e-6:
        return audio.astype(np.float32)
    return (audio / peak * 0.92).astype(np.float32)
