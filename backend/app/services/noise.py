import numpy as np


def classify_noise(audio: np.ndarray, sample_rate: int) -> tuple[str, str, float]:
    if audio.size < sample_rate:
        return "unknown", "噪声样本较短", 0.45

    sample = audio[: min(len(audio), sample_rate * 10)]
    freqs = np.fft.rfftfreq(len(sample), d=1.0 / sample_rate)
    power = np.abs(np.fft.rfft(sample)) ** 2
    total = float(np.sum(power) + 1e-12)
    low = float(np.sum(power[(freqs >= 20) & (freqs < 250)]) / total)
    mid = float(np.sum(power[(freqs >= 250) & (freqs < 3000)]) / total)
    high = float(np.sum(power[(freqs >= 3000)]) / total)

    zcr = float(np.mean(np.abs(np.diff(np.signbit(audio)))))

    if low > 0.55:
        return "wind_or_machine", "风噪/机器低频噪声", min(0.88, low)
    if high > 0.35 and zcr > 0.12:
        return "keyboard_or_hiss", "键盘声/高频嘶声", min(0.86, high + 0.25)
    if mid > 0.55:
        return "crowd_noise", "人群嘈杂/说话背景", min(0.84, mid)
    return "broadband_noise", "宽频环境噪声", 0.62
