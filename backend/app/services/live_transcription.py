import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.schemas import RuntimeOpenAIConfig
from app.services.asr import transcribe_audio
from app.services.audio_io import convert_to_wav, duration_seconds


LIVE_DATA_DIR = "live"


async def transcribe_live_chunk(
    file: UploadFile,
    runtime_config: RuntimeOpenAIConfig,
    session_id: str | None = None,
    sequence: int = 0,
) -> dict:
    settings = get_settings()
    safe_session_id = _safe_session_id(session_id)
    safe_sequence = max(0, sequence)
    chunk_dir = settings.data_dir / LIVE_DATA_DIR / safe_session_id
    chunk_dir.mkdir(parents=True, exist_ok=True)

    input_path = chunk_dir / f"chunk_{safe_sequence:04d}{_suffix_for_upload(file)}"
    wav_path = chunk_dir / f"chunk_{safe_sequence:04d}.wav"

    with input_path.open("wb") as target:
        shutil.copyfileobj(file.file, target)

    convert_to_wav(input_path, wav_path)
    text = transcribe_audio(wav_path, runtime_config)

    return {
        "session_id": safe_session_id,
        "sequence": safe_sequence,
        "text": text,
        "duration": duration_seconds(wav_path),
    }


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
