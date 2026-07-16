from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf


MAX_SPEAKERS_PER_SESSION = 2
SPEAKER_DISTANCE_THRESHOLD = 0.34
FRAME_MS = 40
HOP_MS = 20


@dataclass
class SpeakerProfile:
    label: str
    centroid: np.ndarray
    samples: int = 1


_SESSION_PROFILES: dict[str, list[SpeakerProfile]] = {}


def identify_dominant_speaker(path: Path, session_id: str) -> dict:
    audio, sample_rate = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    profiles = _SESSION_PROFILES.setdefault(session_id, [])
    feature, voice_activity = _voice_feature(audio, sample_rate)
    if feature is None:
        if profiles:
            return _speaker_result(profiles[-1].label, 0.2, voice_activity)
        profile = SpeakerProfile(label=_speaker_label(0), centroid=np.zeros(4, dtype="float32"), samples=0)
        profiles.append(profile)
        return _speaker_result(profile.label, 0.2, voice_activity)

    if not profiles:
        profile = SpeakerProfile(label=_speaker_label(0), centroid=feature)
        profiles.append(profile)
        return _speaker_result(profile.label, 0.68, voice_activity)

    if profiles[-1].samples == 0:
        profiles[-1].centroid = feature
        profiles[-1].samples = 1
        return _speaker_result(profiles[-1].label, 0.68, voice_activity)

    distances = [float(np.linalg.norm(profile.centroid - feature)) for profile in profiles]
    nearest_index = int(np.argmin(distances))
    nearest_distance = distances[nearest_index]
    if nearest_distance > SPEAKER_DISTANCE_THRESHOLD and len(profiles) < MAX_SPEAKERS_PER_SESSION:
        profile = SpeakerProfile(label=_speaker_label(len(profiles)), centroid=feature)
        profiles.append(profile)
        return _speaker_result(profile.label, 0.62, voice_activity)

    profile = profiles[nearest_index]
    weight = 1.0 / float(profile.samples + 1)
    profile.centroid = profile.centroid * (1.0 - weight) + feature * weight
    profile.samples += 1
    confidence = 1.0 - nearest_distance / max(SPEAKER_DISTANCE_THRESHOLD, 1e-6)
    return _speaker_result(profile.label, max(0.35, min(0.96, confidence)), voice_activity)


def _voice_feature(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray | None, float]:
    if audio.size == 0 or sample_rate <= 0:
        return None, 0.0

    audio = audio.astype("float32")
    audio = audio - float(np.mean(audio))
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1e-6:
        audio = audio / peak

    frame_size = max(256, int(sample_rate * FRAME_MS / 1000))
    hop_size = max(128, int(sample_rate * HOP_MS / 1000))
    if audio.size < frame_size:
        return None, 0.0

    frames = _frame_audio(audio, frame_size, hop_size)
    energies = np.mean(frames**2, axis=1)
    if energies.size == 0:
        return None, 0.0

    threshold = max(float(np.percentile(energies, 60)) * 0.7, 1e-5)
    voiced_frames = frames[energies >= threshold]
    voice_activity = float(len(voiced_frames) / max(1, len(frames)))
    if len(voiced_frames) < 3:
        return None, voice_activity

    if len(voiced_frames) > 96:
        indices = np.linspace(0, len(voiced_frames) - 1, num=96).astype(int)
        voiced_frames = voiced_frames[indices]

    pitches: list[float] = []
    centroids: list[float] = []
    bandwidths: list[float] = []
    zcrs: list[float] = []
    freqs = np.fft.rfftfreq(frame_size, d=1.0 / sample_rate)
    nyquist = max(sample_rate / 2.0, 1.0)
    window = np.hanning(frame_size).astype("float32")

    for frame in voiced_frames:
        frame = frame - float(np.mean(frame))
        zcrs.append(float(np.mean(np.abs(np.diff(np.signbit(frame))).astype("float32"))))
        spectrum = np.abs(np.fft.rfft(frame * window)) + 1e-9
        total = float(np.sum(spectrum))
        centroid_hz = float(np.sum(freqs * spectrum) / total)
        bandwidth_hz = float(np.sqrt(np.sum(((freqs - centroid_hz) ** 2) * spectrum) / total))
        centroids.append(centroid_hz / nyquist)
        bandwidths.append(bandwidth_hz / nyquist)
        pitch = _estimate_pitch(frame, sample_rate)
        if pitch:
            pitches.append(pitch)

    if not centroids:
        return None, voice_activity

    median_pitch = float(np.median(pitches)) if pitches else 160.0
    pitch_feature = float(np.clip(np.log2(max(median_pitch, 60.0) / 160.0) / 2.0 + 0.5, 0.0, 1.0))
    feature = np.array(
        [
            pitch_feature,
            float(np.median(centroids)),
            float(np.median(bandwidths)),
            float(np.median(zcrs)),
        ],
        dtype="float32",
    )
    return feature, voice_activity


def _frame_audio(audio: np.ndarray, frame_size: int, hop_size: int) -> np.ndarray:
    starts = range(0, audio.size - frame_size + 1, hop_size)
    return np.stack([audio[start : start + frame_size] for start in starts])


def _estimate_pitch(frame: np.ndarray, sample_rate: int) -> float | None:
    min_lag = max(1, int(sample_rate / 350))
    max_lag = min(len(frame) - 1, int(sample_rate / 80))
    if max_lag <= min_lag:
        return None
    corr = np.correlate(frame, frame, mode="full")[len(frame) - 1 :]
    corr[:min_lag] = 0
    lag = int(np.argmax(corr[min_lag : max_lag + 1]) + min_lag)
    if lag <= 0 or corr[lag] <= 1e-6:
        return None
    return float(sample_rate / lag)


def _speaker_label(index: int) -> str:
    if index < 26:
        return f"说话人 {chr(ord('A') + index)}"
    return f"说话人 {index + 1}"


def _speaker_result(label: str, confidence: float, voice_activity: float) -> dict:
    return {
        "speaker_label": label,
        "speaker_confidence": round(float(confidence), 2),
        "voice_activity": round(float(voice_activity), 3),
    }
