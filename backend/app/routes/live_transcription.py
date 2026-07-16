from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.schemas import RuntimeOpenAIConfig
from app.services.live_transcription import transcribe_live_chunk


router = APIRouter(prefix="/api/live", tags=["live-transcription"])


@router.post("/transcribe")
async def transcribe_live_audio(
    file: UploadFile = File(...),
    session_id: str | None = Form(default=None),
    sequence: int = Form(default=0),
    asr_provider: str | None = Form(default=None),
    asr_api_key: str | None = Form(default=None),
    asr_base_url: str | None = Form(default=None),
    asr_model: str | None = Form(default=None),
    xunfei_app_id: str | None = Form(default=None),
    xunfei_api_key: str | None = Form(default=None),
    xunfei_api_secret: str | None = Form(default=None),
) -> dict:
    if not file.content_type or not file.content_type.startswith(("audio/", "video/", "application/octet-stream")):
        raise HTTPException(status_code=400, detail="请上传录音音频片段")

    runtime_config = RuntimeOpenAIConfig(
        asr_provider=_clean_form_value(asr_provider),
        asr_api_key=_clean_form_value(asr_api_key),
        asr_base_url=_clean_form_value(asr_base_url),
        asr_model=_clean_form_value(asr_model),
        xunfei_app_id=_clean_form_value(xunfei_app_id),
        xunfei_api_key=_clean_form_value(xunfei_api_key),
        xunfei_api_secret=_clean_form_value(xunfei_api_secret),
    )

    try:
        return await transcribe_live_chunk(
            file=file,
            runtime_config=runtime_config,
            session_id=_clean_form_value(session_id),
            sequence=sequence,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="未找到 ffmpeg，无法转码实时录音片段") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _clean_form_value(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None
