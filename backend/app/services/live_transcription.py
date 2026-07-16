import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.schemas import RuntimeOpenAIConfig
from app.services.asr import transcribe_audio
from app.services.audio_io import convert_to_wav, duration_seconds
from app.services.enhance import enhance_speech_file
from app.services.llm import refine_live_transcript
from app.services.speaker_profile import identify_dominant_speaker


LIVE_DATA_DIR = "live"


async def transcribe_live_chunk(
    file: UploadFile,
    runtime_config: RuntimeOpenAIConfig,
    session_id: str | None = None,
    sequence: int = 0,
    enhance: bool = False,
    llm_optimize: bool = False,
    topic: str | None = None,
) -> dict:
    settings = get_settings()
    safe_session_id = _safe_session_id(session_id)
    safe_sequence = max(0, sequence)
    chunk_dir = settings.data_dir / LIVE_DATA_DIR / safe_session_id
    chunk_dir.mkdir(parents=True, exist_ok=True)

    input_path = chunk_dir / f"chunk_{safe_sequence:04d}{_suffix_for_upload(file)}"
    wav_path = chunk_dir / f"chunk_{safe_sequence:04d}.wav"
    enhanced_path = chunk_dir / f"chunk_{safe_sequence:04d}_enhanced.wav"

    with input_path.open("wb") as target:
        shutil.copyfileobj(file.file, target)

    convert_to_wav(input_path, wav_path)
    transcribe_path = wav_path
    if enhance:
        enhance_speech_file(wav_path, enhanced_path, atten_lim=runtime_config.atten_lim)
        transcribe_path = enhanced_path
    speaker = identify_dominant_speaker(transcribe_path, safe_session_id)
    raw_text = transcribe_audio(transcribe_path, runtime_config)
    should_optimize = llm_optimize and _is_refinable_text(raw_text)
    text = refine_live_transcript(raw_text, topic, runtime_config) if should_optimize else raw_text

    return {
        "session_id": safe_session_id,
        "sequence": safe_sequence,
        "text": text,
        "raw_text": raw_text,
        "duration": duration_seconds(transcribe_path),
        "enhanced": enhance,
        "optimized": should_optimize and text != raw_text,
        **speaker,
    }


def _is_refinable_text(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned:
        return False
    status_markers = ("未配置", "未安装", "失败", "超时", "未识别到有效语音")
    return not any(marker in cleaned for marker in status_markers)


def _safe_session_id(session_id: str | None) -> str:
    if not session_id:
        return uuid.uuid4().hex[:12]
    safe = "".join(char for char in session_id if char.isalnum() or char in {"-", "_"})
    return safe[:64] or uuid.uuid4().hex[:12]


def _suffix_for_upload(file: UploadFile) -> str:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix:
        return suffix
    content_type = (file.content_type or "").lower()
    if "webm" in content_type:
        return ".webm"
    if "mp4" in content_type:
        return ".mp4"
    if "mpeg" in content_type or "mp3" in content_type:
        return ".mp3"
    if "wav" in content_type:
        return ".wav"
    return ".webm"
