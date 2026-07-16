import base64
import concurrent.futures
import hashlib
import hmac
import json
import time
import wave
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib import error, request
from urllib.parse import urlencode, urlparse, urlunparse

from openai import OpenAI

try:
    from opencc import OpenCC
except ImportError:
    OpenCC = None

try:
    from websocket import WebSocketTimeoutException, create_connection
except ImportError:
    WebSocketTimeoutException = TimeoutError
    create_connection = None

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

DASHSCOPE_FUN_ASR_PROVIDERS = {"dashscope-fun-asr", "dashscope-paraformer"}
DASHSCOPE_FUN_ASR_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com"
DASHSCOPE_FUN_ASR_GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation"
DASHSCOPE_FUN_ASR_DEFAULT_MODEL = "fun-asr-flash-2026-06-15"
DASHSCOPE_FUN_ASR_MODEL_ALIASES = {
    "fun-asr": DASHSCOPE_FUN_ASR_DEFAULT_MODEL,
    "fun-asr-flash": DASHSCOPE_FUN_ASR_DEFAULT_MODEL,
    "paraformer": DASHSCOPE_FUN_ASR_DEFAULT_MODEL,
    "paraformer-v2": DASHSCOPE_FUN_ASR_DEFAULT_MODEL,
}
DASHSCOPE_FUN_ASR_MAX_DATA_URI_BYTES = 10 * 1024 * 1024

PLANNED_ASR_PROVIDERS = {
    "dashscope-qwen-audio": "阿里云录音文件识别-千问需要接入 DashScope 千问音频理解/识别接口，不能直接走 OpenAI audio/transcriptions。",
    "volcengine": "火山引擎 ASR 需要火山专用签名和任务接口，当前版本尚未实现。",
    "tencent": "腾讯云 ASR 需要腾讯云 SDK/签名接口，当前版本尚未实现。",
    "baidu": "百度智能云 ASR 需要百度 OAuth/REST 接口，当前版本尚未实现。",
}

_T2S_CONVERTER = OpenCC("t2s") if OpenCC else None
ASR_TIMEOUT_SECONDS = 120


def transcribe_audio(path: Path, runtime_config: RuntimeOpenAIConfig | None = None) -> str:
    settings = get_settings()
    provider = ((runtime_config.asr_provider if runtime_config else None) or "openai").strip()
    if provider == "local-whisper":
        model = (runtime_config.asr_model if runtime_config else None) or "medium"
        return _run_with_timeout(
            lambda: _to_simplified_chinese(_transcribe_with_faster_whisper(path, model)),
            "本地 faster-whisper",
        )

    if provider == "xunfei":
        return _run_with_timeout(
            lambda: _to_simplified_chinese(_transcribe_with_xunfei(path, runtime_config)),
            "讯飞 ASR",
        )

    if provider in DASHSCOPE_FUN_ASR_PROVIDERS:
        api_key = runtime_config.asr_api_key if runtime_config else None
        base_url = (runtime_config.asr_base_url if runtime_config else None) or DASHSCOPE_FUN_ASR_DEFAULT_BASE_URL
        model = (runtime_config.asr_model if runtime_config else None) or DASHSCOPE_FUN_ASR_DEFAULT_MODEL
        if not api_key:
            return "未配置阿里 Fun-ASR 的 ASR API Key，已完成音频增强。"
        return _run_with_timeout(
            lambda: _to_simplified_chinese(_transcribe_with_dashscope_fun_asr(path, api_key, base_url, model)),
            "阿里 Fun-ASR",
        )

    if provider in PLANNED_ASR_PROVIDERS:
        return f"ASR Provider '{provider}' 已加入配置入口，但后端适配尚未完成：{PLANNED_ASR_PROVIDERS[provider]}"

    if provider not in OPENAI_AUDIO_PROVIDERS:
        supported = ", ".join(
            ["local-whisper", "xunfei", "dashscope-fun-asr", *OPENAI_AUDIO_PROVIDERS.keys(), *PLANNED_ASR_PROVIDERS.keys()]
        )
        return f"不支持的 ASR Provider：{provider}。当前支持/预留：{supported}"

    provider_defaults = OPENAI_AUDIO_PROVIDERS[provider]
    api_key = (runtime_config.asr_api_key if runtime_config else None) or settings.openai_api_key
    base_url = (runtime_config.asr_base_url if runtime_config else None) or provider_defaults["base_url"] or settings.openai_base_url
    model = (runtime_config.asr_model if runtime_config else None) or provider_defaults["model"] or settings.asr_model

    if not api_key:
        return f"未配置 {provider_defaults['label']} 的 ASR API Key，已完成音频增强。"

    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=ASR_TIMEOUT_SECONDS)
        with path.open("rb") as audio_file:
            result = client.audio.transcriptions.create(model=model, file=audio_file)
        return _to_simplified_chinese(result.text)
    except Exception as exc:
        return f"{provider_defaults['label']} 转写失败：{exc}"


def _to_simplified_chinese(text: str) -> str:
    if not text or _T2S_CONVERTER is None:
        return text
    return _T2S_CONVERTER.convert(text)


def _run_with_timeout(action, label: str) -> str:
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(action)
    try:
        return future.result(timeout=ASR_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        return f"{label} 转写超时：超过 {ASR_TIMEOUT_SECONDS} 秒未完成。建议先使用更短音频，或改用分段/长音频 ASR。"
    except Exception as exc:
        return f"{label} 转写失败：{exc}"
    finally:
        if future.done():
            executor.shutdown(wait=False, cancel_futures=True)


def _transcribe_with_xunfei(path: Path, runtime_config: RuntimeOpenAIConfig | None) -> str:
    settings = get_settings()
    app_id = (runtime_config.xunfei_app_id if runtime_config else None) or settings.xunfei_app_id
    api_key = (runtime_config.xunfei_api_key if runtime_config else None) or settings.xunfei_api_key
    api_secret = (runtime_config.xunfei_api_secret if runtime_config else None) or settings.xunfei_api_secret
    if not app_id or not api_key or not api_secret:
        return "未配置讯飞 ASR。请填写 XUNFEI_APP_ID、XUNFEI_API_KEY、XUNFEI_API_SECRET。"
    if create_connection is None:
        return "未安装 websocket-client。请在 backend 目录执行：python -m pip install -r requirements.txt"

    try:
        url = _xunfei_iat_url(api_key, api_secret)
        ws = create_connection(url, timeout=10)
        try:
            return _xunfei_iat_stream(ws, path, app_id)
        finally:
            ws.close()
    except Exception as exc:
        return f"讯飞 ASR 调用失败：{exc}"


def _xunfei_iat_url(api_key: str, api_secret: str) -> str:
    host = "iat-api.xfyun.cn"
    path = "/v2/iat"
    date = format_datetime(datetime.now(timezone.utc), usegmt=True)
    signature_origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    signature_sha = hmac.new(api_secret.encode("utf-8"), signature_origin.encode("utf-8"), hashlib.sha256).digest()
    signature = base64.b64encode(signature_sha).decode("utf-8")
    authorization_origin = f'api_key="{api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="{signature}"'
    authorization = base64.b64encode(authorization_origin.encode("utf-8")).decode("utf-8")
    return f"wss://{host}{path}?{urlencode({'authorization': authorization, 'date': date, 'host': host})}"


def _xunfei_iat_stream(ws, path: Path, app_id: str) -> str:
    frames_per_chunk = 640
    status_first = 0
    status_continue = 1
    status_last = 2
    results: list[str] = []
    deadline = time.monotonic() + ASR_TIMEOUT_SECONDS

    with wave.open(str(path), "rb") as audio_file:
        if audio_file.getnchannels() != 1 or audio_file.getsampwidth() != 2 or audio_file.getframerate() != 16000:
            return "讯飞 ASR 需要 16kHz 单声道 PCM_16 WAV 音频。"

        status = status_first
        while True:
            chunk = audio_file.readframes(frames_per_chunk)
            if not chunk:
                break
            if time.monotonic() > deadline:
                return f"讯飞 ASR 转写超时：超过 {ASR_TIMEOUT_SECONDS} 秒未完成。"

            is_last = audio_file.tell() >= audio_file.getnframes()
            frame_status = status_last if is_last else status
            _send_xunfei_frame(ws, app_id, chunk, frame_status)
            completed = _read_xunfei_messages(ws, results, wait_until_complete=frame_status == status_last, deadline=deadline)
            if completed:
                break
            status = status_continue
            if frame_status == status_last:
                break
            time.sleep(0.04)

    return "".join(results).strip() or "讯飞 ASR 未识别到有效语音。"


def _read_xunfei_messages(ws, results: list[str], wait_until_complete: bool, deadline: float) -> bool:
    ws.settimeout(5 if wait_until_complete else 0.2)
    while True:
        if time.monotonic() > deadline:
            results.append(f"讯飞 ASR 转写超时：超过 {ASR_TIMEOUT_SECONDS} 秒未完成。")
            return True
        try:
            response = json.loads(ws.recv())
        except WebSocketTimeoutException:
            return False

        data = response.get("data") or {}
        if response.get("code") != 0:
            message = response.get("message") or response.get("desc") or "未知错误"
            results.append(f"讯飞 ASR 转写失败：{message}")
            return True

        result = data.get("result") or {}
        text = "".join(item.get("w", "") for ws_item in result.get("ws", []) for item in ws_item.get("cw", []))
        if text:
            results.append(text)
        if data.get("status") == 2:
            return True
        if not wait_until_complete:
            return False


def _send_xunfei_frame(ws, app_id: str, audio: bytes, status: int) -> None:
    payload = {
        "common": {"app_id": app_id},
        "business": {
            "language": "zh_cn",
            "domain": "iat",
            "accent": "mandarin",
            "vad_eos": 5000,
        },
        "data": {
            "status": status,
            "format": "audio/L16;rate=16000",
            "encoding": "raw",
            "audio": base64.b64encode(audio).decode("utf-8"),
        },
    }
    ws.send(json.dumps(payload, ensure_ascii=False))


def _transcribe_with_dashscope_fun_asr(path: Path, api_key: str, base_url: str, model_name: str) -> str:
    normalized_model = _normalize_dashscope_fun_asr_model(model_name)
    audio_data_uri = _audio_data_uri(path)
    if len(audio_data_uri.encode("utf-8")) > DASHSCOPE_FUN_ASR_MAX_DATA_URI_BYTES:
        raise RuntimeError("阿里 Fun-ASR Flash 当前单个音频 Data URI 上限约 10 MB，请换用 30-90 秒以内的短音频。")

    payload = {
        "model": normalized_model,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": audio_data_uri,
                            },
                        },
                    ],
                }
            ]
        },
        "parameters": {
            "format": "wav",
            "sample_rate": "16000",
        },
    }
    body = json.dumps(payload).encode("utf-8")
    http_request = request.Request(
        _dashscope_fun_asr_generation_url(base_url),
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-DashScope-SSE": "disable",
        },
        method="POST",
    )

    try:
        with request.urlopen(http_request, timeout=ASR_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"阿里 Fun-ASR 请求失败：HTTP {exc.code}，模型：{normalized_model}，详情：{detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"阿里 Fun-ASR 请求失败：{exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError("阿里 Fun-ASR 请求超时，请稍后重试或换一段更短的音频。") from exc

    text = _extract_dashscope_fun_asr_text(result)
    if not text:
        raise RuntimeError(f"阿里 Fun-ASR 未返回转写文本：{result}")
    return text


def _audio_data_uri(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:audio/wav;base64,{encoded}"


def _normalize_dashscope_fun_asr_model(model_name: str) -> str:
    normalized = (model_name or DASHSCOPE_FUN_ASR_DEFAULT_MODEL).strip()
    return DASHSCOPE_FUN_ASR_MODEL_ALIASES.get(normalized, normalized)


def _dashscope_fun_asr_generation_url(base_url: str) -> str:
    configured = (base_url or DASHSCOPE_FUN_ASR_DEFAULT_BASE_URL).strip().rstrip("/")
    parsed = urlparse(configured)
    if not parsed.scheme or not parsed.netloc:
        return DASHSCOPE_FUN_ASR_DEFAULT_BASE_URL + DASHSCOPE_FUN_ASR_GENERATION_PATH
    if parsed.path.rstrip("/") == DASHSCOPE_FUN_ASR_GENERATION_PATH:
        return configured
    return urlunparse((parsed.scheme, parsed.netloc, DASHSCOPE_FUN_ASR_GENERATION_PATH, "", "", ""))


def _extract_dashscope_fun_asr_text(result: dict) -> str:
    output = result.get("output") if isinstance(result, dict) else None
    if isinstance(output, dict):
        text = output.get("text")
        if isinstance(text, str):
            return text.strip()
        choices = output.get("choices")
        if isinstance(choices, list):
            pieces = [_extract_text_from_choice(choice) for choice in choices]
            return "".join(piece for piece in pieces if piece).strip()
    return ""


def _extract_text_from_choice(choice: object) -> str:
    if not isinstance(choice, dict):
        return ""
    message = choice.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(_extract_content_piece(piece) for piece in content)
    text = choice.get("text")
    return text if isinstance(text, str) else ""


def _extract_content_piece(piece: object) -> str:
    if isinstance(piece, str):
        return piece
    if not isinstance(piece, dict):
        return ""
    text = piece.get("text")
    return text if isinstance(text, str) else ""


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
