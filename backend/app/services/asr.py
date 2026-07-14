from pathlib import Path

from openai import OpenAI

from app.config import get_settings
from app.schemas import RuntimeOpenAIConfig


def transcribe_audio(path: Path, runtime_config: RuntimeOpenAIConfig | None = None) -> str:
    settings = get_settings()
    provider = (runtime_config.asr_provider if runtime_config else None) or "openai"
    if provider == "local-whisper":
        model = (runtime_config.asr_model if runtime_config else None) or "medium"
        return _transcribe_with_faster_whisper(path, model)

    api_key = (runtime_config.asr_api_key if runtime_config else None) or settings.openai_api_key
    base_url = (runtime_config.asr_base_url if runtime_config else None) or settings.openai_base_url
    model = (runtime_config.asr_model if runtime_config else None) or settings.asr_model

    if not api_key:
        return "未配置 OPENAI_API_KEY，已完成音频增强。配置后可启用 Whisper API 转写。"

    client = OpenAI(api_key=api_key, base_url=base_url)
    with path.open("rb") as audio_file:
        result = client.audio.transcriptions.create(model=model, file=audio_file)
    return result.text


def _transcribe_with_faster_whisper(path: Path, model_name: str) -> str:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return "未安装 faster-whisper。请在 backend 目录执行：python -m pip install -r requirements.txt"

    device, compute_type = _select_runtime()
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as exc:
        if device == "cuda":
            model = WhisperModel(model_name, device="cpu", compute_type="int8")
        else:
            raise exc

    segments, info = model.transcribe(
        str(path),
        language="zh",
        vad_filter=True,
        beam_size=5,
    )
    text = "".join(segment.text for segment in segments).strip()
    if not text:
        return f"本地 faster-whisper 未识别到有效语音。模型：{model_name}，语言：{info.language}"
    return text


def _select_runtime() -> tuple[str, str]:
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"
