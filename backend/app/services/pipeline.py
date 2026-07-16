import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.schemas import (
    AudioInfo,
    EnhanceResult,
    LlmResult,
    Metrics,
    NoiseInfo,
    ProcessResult,
    RuntimeOpenAIConfig,
    TranscribeResult,
    Transcription,
)
from app.services.asr import transcribe_audio
from app.services.audio_io import convert_to_wav, duration_seconds, load_audio
from app.services.enhance import enhance_speech_file
from app.services.llm import summarize_transcript
from app.services.metrics import estimate_snr, noise_reduction_ratio, rms
from app.services.metrics import waveform_peaks
from app.services.noise import classify_noise


async def process_upload(file: UploadFile, runtime_config: RuntimeOpenAIConfig | None = None) -> ProcessResult:
    enhance_result = await enhance_upload(file, runtime_config)
    settings = get_settings()
    runtime_config = runtime_config or RuntimeOpenAIConfig()
    should_run_asr = _should_run_asr(runtime_config, settings.openai_api_key)
    raw_available = bool(should_run_asr and runtime_config.transcribe_original)
    enhanced_available = bool(should_run_asr and runtime_config.enhance_audio and runtime_config.transcribe_enhanced)

    if raw_available:
        raw_text = transcribe_task_audio(enhance_result.task_id, "original", runtime_config).text
    elif runtime_config.transcribe_original:
        raw_text = "未配置可用 ASR，未执行原始音频转写。"
    else:
        raw_text = "已跳过原始音频转写。"

    if not runtime_config.enhance_audio:
        enhanced_text = "已跳过语音增强，未生成增强音频。"
    elif enhanced_available:
        enhanced_text = transcribe_task_audio(enhance_result.task_id, "enhanced", runtime_config).text
    elif runtime_config.transcribe_enhanced:
        enhanced_text = "未配置可用 ASR，未执行增强音频转写。"
    else:
        enhanced_text = "已生成增强音频，已跳过增强后转写。"

    summary_source = _summary_source(raw_text, enhanced_text, raw_available, enhanced_available)
    llm_data = summarize_transcript(summary_source, runtime_config) if summary_source else {
        "summary": "未执行语音转写，暂无语义摘要。",
        "keywords": [],
        "action_items": [],
    }

    return ProcessResult(
        task_id=enhance_result.task_id,
        status="completed",
        audio=enhance_result.audio,
        noise=enhance_result.noise,
        metrics=enhance_result.metrics,
        transcription=Transcription(
            raw_text=raw_text,
            enhanced_text=enhanced_text,
            raw_available=raw_available,
            enhanced_available=enhanced_available,
        ),
        llm=LlmResult(**llm_data),
    )


async def enhance_upload(file: UploadFile, runtime_config: RuntimeOpenAIConfig | None = None) -> EnhanceResult:
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
    atten_lim = max(0, min(100, runtime_config.atten_lim))
    noise_type, noise_label, confidence = classify_noise(audio, sample_rate)
    snr_before = estimate_snr(audio)
    rms_before = rms(audio)

    if runtime_config.enhance_audio:
        enhance_speech_file(original_wav, enhanced_wav, atten_lim=atten_lim)
        enhanced, _ = load_audio(enhanced_wav)
        enhanced_url = f"/api/audio/file/{task_id}/enhanced"
        enhanced_peaks = waveform_peaks(enhanced)
        snr_after = estimate_snr(enhanced)
        rms_after = rms(enhanced)
        enhanced_size_bytes = enhanced_wav.stat().st_size
        reduction_ratio = noise_reduction_ratio(audio, enhanced)
    else:
        enhanced_url = None
        enhanced_peaks = []
        snr_after = snr_before
        rms_after = rms_before
        enhanced_size_bytes = 0
        reduction_ratio = "0%"

    return EnhanceResult(
        task_id=task_id,
        status="completed",
        audio=AudioInfo(
            original_url=f"/api/audio/file/{task_id}/original",
            enhanced_url=enhanced_url,
            duration=duration_seconds(original_wav),
            sample_rate=sample_rate,
            original_peaks=waveform_peaks(audio),
            enhanced_peaks=enhanced_peaks,
        ),
        noise=NoiseInfo(noise_type=noise_type, noise_label=noise_label, confidence=round(confidence, 2)),
        metrics=Metrics(
            snr_before=snr_before,
            snr_after=snr_after,
            snr_gain=round(snr_after - snr_before, 2),
            noise_reduction_ratio=reduction_ratio,
            rms_before=rms_before,
            rms_after=rms_after,
            original_size_bytes=original_wav.stat().st_size,
            enhanced_size_bytes=enhanced_size_bytes,
        ),
    )


def transcribe_task_audio(task_id: str, kind: str, runtime_config: RuntimeOpenAIConfig | None = None) -> TranscribeResult:
    if kind not in {"original", "enhanced"}:
        raise FileNotFoundError("不支持的音频类型")
    settings = get_settings()
    path = settings.outputs_dir / task_id / f"{kind}.wav"
    if not path.exists():
        raise FileNotFoundError("音频文件不存在，请先完成音频增强")
    try:
        text = transcribe_audio(path, runtime_config or RuntimeOpenAIConfig())
    except Exception as exc:
        label = "原始音频" if kind == "original" else "增强音频"
        text = f"{label}转写失败：{exc}"
    return TranscribeResult(task_id=task_id, kind=kind, text=text)


def summarize_text(text: str, runtime_config: RuntimeOpenAIConfig | None = None) -> LlmResult:
    return LlmResult(**summarize_transcript(text, runtime_config or RuntimeOpenAIConfig()))


def _should_run_asr(runtime_config: RuntimeOpenAIConfig, fallback_api_key: str | None) -> bool:
    cloud_or_local_providers = {"local-whisper", "xunfei", "dashscope-fun-asr", "dashscope-paraformer"}
    return bool(
        runtime_config.asr_provider in cloud_or_local_providers
        or runtime_config.has_asr_api_key
        or fallback_api_key
    )


def _summary_source(raw_text: str, enhanced_text: str, raw_available: bool, enhanced_available: bool) -> str:
    if enhanced_available and enhanced_text.strip():
        return enhanced_text
    if raw_available and raw_text.strip():
        return raw_text
    return ""


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
