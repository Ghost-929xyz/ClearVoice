import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.schemas import AudioInfo, LlmResult, Metrics, NoiseInfo, ProcessResult, RuntimeOpenAIConfig, Transcription
from app.services.asr import transcribe_audio
from app.services.audio_io import convert_to_wav, duration_seconds, load_audio, save_audio
from app.services.enhance import enhance_speech
from app.services.llm import summarize_transcript
from app.services.metrics import estimate_snr, noise_reduction_ratio, rms
from app.services.metrics import waveform_peaks
from app.services.noise import classify_noise


async def process_upload(file: UploadFile, runtime_config: RuntimeOpenAIConfig | None = None) -> ProcessResult:
    settings = get_settings()
    runtime_config = runtime_config or RuntimeOpenAIConfig()
    task_id = uuid.uuid4().hex[:12]
    upload_dir = settings.uploads_dir / task_id
    output_dir = settings.outputs_dir / task_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    uploaded_path = upload_dir / f"input{suffix}"
    with uploaded_path.open("wb") as target:
        shutil.copyfileobj(file.file, target)

    original_wav = output_dir / "original.wav"
    enhanced_wav = output_dir / "enhanced.wav"
    convert_to_wav(uploaded_path, original_wav)

    audio, sample_rate = load_audio(original_wav)
    enhanced = enhance_speech(audio, sample_rate)
    save_audio(enhanced_wav, enhanced, sample_rate)

    noise_type, noise_label, confidence = classify_noise(audio, sample_rate)
    snr_before = estimate_snr(audio)
    snr_after = estimate_snr(enhanced)
    if runtime_config.asr_provider == "local-whisper" or runtime_config.has_asr_api_key or settings.openai_api_key:
        raw_text = transcribe_audio(original_wav, runtime_config)
        enhanced_text = transcribe_audio(enhanced_wav, runtime_config)
    else:
        raw_text = _local_analysis_text(
            "原始音频",
            duration_seconds(original_wav),
            sample_rate,
            snr_before,
            rms(audio),
            noise_label,
            "未配置 OPENAI_API_KEY，因此暂未执行语音转写。",
        )
        enhanced_text = _local_analysis_text(
            "增强音频",
            duration_seconds(enhanced_wav),
            sample_rate,
            snr_after,
            rms(enhanced),
            noise_label,
            f"已生成可播放的增强音频，估计 SNR 提升 {round(snr_after - snr_before, 2)} dB，噪声抑制 {noise_reduction_ratio(audio, enhanced)}。",
        )
    llm_data = summarize_transcript(enhanced_text, runtime_config)

    return ProcessResult(
        task_id=task_id,
        status="completed",
        audio=AudioInfo(
            original_url=f"/api/audio/file/{task_id}/original",
            enhanced_url=f"/api/audio/file/{task_id}/enhanced",
            duration=duration_seconds(original_wav),
            sample_rate=sample_rate,
            original_peaks=waveform_peaks(audio),
            enhanced_peaks=waveform_peaks(enhanced),
        ),
        noise=NoiseInfo(noise_type=noise_type, noise_label=noise_label, confidence=round(confidence, 2)),
        metrics=Metrics(
            snr_before=snr_before,
            snr_after=snr_after,
            snr_gain=round(snr_after - snr_before, 2),
            noise_reduction_ratio=noise_reduction_ratio(audio, enhanced),
            rms_before=rms(audio),
            rms_after=rms(enhanced),
            original_size_bytes=original_wav.stat().st_size,
            enhanced_size_bytes=enhanced_wav.stat().st_size,
        ),
        transcription=Transcription(raw_text=raw_text, enhanced_text=enhanced_text),
        llm=LlmResult(**llm_data),
    )


def _local_analysis_text(
    title: str,
    duration: float,
    sample_rate: int,
    snr: float,
    rms_value: float,
    noise_label: str,
    note: str,
) -> str:
    return (
        f"{title}本地分析结果：\n"
        f"- 时长：{duration}s\n"
        f"- 采样率：{sample_rate} Hz\n"
        f"- 估计 SNR：{snr} dB\n"
        f"- RMS 能量：{rms_value}\n"
        f"- 主要噪声：{noise_label}\n"
        f"- 说明：{note}"
    )
