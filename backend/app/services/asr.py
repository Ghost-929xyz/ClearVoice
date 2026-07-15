from pathlib import Path

from openai import OpenAI

from app.config import get_settings
from app.schemas import RuntimeOpenAIConfig


OPENAI_AUDIO_PROVIDERS = {
    "openai": {
        "label": "OpenAI Whisper",
        "base_url": "https://api.openai.com/v1",
        "model": "whisper-1",
    },
    "openai-compatible": {
        "label": "OpenAI-compatible ASR",
        "base_url": None,
        "model": "whisper-1",
    },
    "groq": {
        "label": "Groq Whisper",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "whisper-large-v3-turbo",
    },
    "fireworks": {
        "label": "Fireworks Whisper",
        "base_url": "https://api.fireworks.ai/inference/v1",
        "model": "whisper-v3",
    },
}

PLANNED_ASR_PROVIDERS = {
    "dashscope": "阿里云 DashScope SenseVoice/Paraformer 需要接入 DashScope 专用 API，不能直接走 OpenAI audio/transcriptions。",
    "xunfei": "讯飞 ASR 需要 WebAPI 签名鉴权和专用接口，当前版本尚未实现。",
    "volcengine": "火山引擎 ASR 需要火山专用签名和任务接口，当前版本尚未实现。",
    "tencent": "腾讯云 ASR 需要腾讯云 SDK/签名接口，当前版本尚未实现。",
    "baidu": "百度智能云 ASR 需要百度 OAuth/REST 接口，当前版本尚未实现。",
}


def transcribe_audio(path: Path, runtime_config: RuntimeOpenAIConfig | None = None) -> str:
    settings = get_settings()
    provider = (runtime_config.asr_provider if runtime_config else None) or "openai"
    if provider == "local-whisper":
        model = (runtime_config.asr_model if runtime_config else None) or "medium"
        return _transcribe_with_faster_whisper(path, model)

    if provider in PLANNED_ASR_PROVIDERS:
        return f"ASR Provider '{provider}' 已加入配置入口，但后端适配尚未完成：{PLANNED_ASR_PROVIDERS[provider]}"

    if provider not in OPENAI_AUDIO_PROVIDERS:
        supported = ", ".join(["local-whisper", *OPENAI_AUDIO_PROVIDERS.keys(), *PLANNED_ASR_PROVIDERS.keys()])
        return f"不支持的 ASR Provider：{provider}。当前支持/预留：{supported}"

    provider_defaults = OPENAI_AUDIO_PROVIDERS[provider]
    api_key = (runtime_config.asr_api_key if runtime_config else None) or settings.openai_api_key
    base_url = (runtime_config.asr_base_url if runtime_config else None) or provider_defaults["base_url"] or settings.openai_base_url
    model = (runtime_config.asr_model if runtime_config else None) or provider_defaults["model"] or settings.asr_model

    if not api_key:
        return f"未配置 {provider_defaults['label']} 的 ASR API Key，已完成音频增强。"

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
