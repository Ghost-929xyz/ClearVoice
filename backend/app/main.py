from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import get_settings
from app.routes.live_transcription import router as live_transcription_router
from app.schemas import EnhanceResult, LlmResult, ProcessResult, RuntimeOpenAIConfig, TranscribeResult
from app.services.enhance import EnhancementError
from app.services.pipeline import enhance_upload, process_upload, summarize_text, transcribe_task_audio

app = FastAPI(title="ClearVoice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(live_transcription_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/audio/process", response_model=ProcessResult)
async def process_audio(
    file: UploadFile = File(...),
    asr_provider: str | None = Form(default=None),
    asr_api_key: str | None = Form(default=None),
    asr_base_url: str | None = Form(default=None),
    asr_model: str | None = Form(default=None),
    llm_api_key: str | None = Form(default=None),
    llm_base_url: str | None = Form(default=None),
    llm_model: str | None = Form(default=None),
    xunfei_app_id: str | None = Form(default=None),
    xunfei_api_key: str | None = Form(default=None),
    xunfei_api_secret: str | None = Form(default=None),
    atten_lim: int = Form(default=20),
    enhance_audio: bool = Form(default=True),
    transcribe_original: bool = Form(default=False),
    transcribe_enhanced: bool = Form(default=True),
) -> ProcessResult:
    if not file.content_type or not file.content_type.startswith(("audio/", "video/", "application/octet-stream")):
        raise HTTPException(status_code=400, detail="请上传音频或视频文件")
    try:
        runtime_config = RuntimeOpenAIConfig(
            asr_provider=_clean_form_value(asr_provider),
            asr_api_key=_clean_form_value(asr_api_key),
            asr_base_url=_clean_form_value(asr_base_url),
            asr_model=_clean_form_value(asr_model),
            llm_api_key=_clean_form_value(llm_api_key),
            llm_base_url=_clean_form_value(llm_base_url),
            llm_model=_clean_form_value(llm_model),
            xunfei_app_id=_clean_form_value(xunfei_app_id),
            xunfei_api_key=_clean_form_value(xunfei_api_key),
            xunfei_api_secret=_clean_form_value(xunfei_api_secret),
            atten_lim=max(0, min(100, atten_lim)),
            enhance_audio=enhance_audio,
            transcribe_original=transcribe_original,
            transcribe_enhanced=transcribe_enhanced,
        )
        return await process_upload(file, runtime_config)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="未找到 ffmpeg，请安装 ffmpeg、配置 FFMPEG_PATH，或将解压后的 ffmpeg 包放到项目根目录、tools 或 backend/tools 目录",
        ) from exc
    except EnhancementError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/audio/enhance", response_model=EnhanceResult)
async def enhance_audio(
    file: UploadFile = File(...),
    atten_lim: int = Form(default=20),
) -> EnhanceResult:
    if not file.content_type or not file.content_type.startswith(("audio/", "video/", "application/octet-stream")):
        raise HTTPException(status_code=400, detail="请上传音频或视频文件")
    try:
        runtime_config = RuntimeOpenAIConfig(atten_lim=max(0, min(100, atten_lim)))
        return await enhance_upload(file, runtime_config)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="未找到 ffmpeg，请安装 ffmpeg 或配置 FFMPEG_PATH") from exc
    except EnhancementError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/audio/transcribe", response_model=TranscribeResult)
def transcribe_audio_endpoint(
    task_id: str = Form(...),
    kind: str = Form(default="enhanced"),
    asr_provider: str | None = Form(default=None),
    asr_api_key: str | None = Form(default=None),
    asr_base_url: str | None = Form(default=None),
    asr_model: str | None = Form(default=None),
    xunfei_app_id: str | None = Form(default=None),
    xunfei_api_key: str | None = Form(default=None),
    xunfei_api_secret: str | None = Form(default=None),
) -> TranscribeResult:
    try:
        runtime_config = RuntimeOpenAIConfig(
            asr_provider=_clean_form_value(asr_provider),
            asr_api_key=_clean_form_value(asr_api_key),
            asr_base_url=_clean_form_value(asr_base_url),
            asr_model=_clean_form_value(asr_model),
            xunfei_app_id=_clean_form_value(xunfei_app_id),
            xunfei_api_key=_clean_form_value(xunfei_api_key),
            xunfei_api_secret=_clean_form_value(xunfei_api_secret),
        )
        return transcribe_task_audio(task_id, kind, runtime_config)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/audio/summarize", response_model=LlmResult)
def summarize_audio_text(
    text: str = Form(...),
    llm_api_key: str | None = Form(default=None),
    llm_base_url: str | None = Form(default=None),
    llm_model: str | None = Form(default=None),
) -> LlmResult:
    try:
        runtime_config = RuntimeOpenAIConfig(
            llm_api_key=_clean_form_value(llm_api_key),
            llm_base_url=_clean_form_value(llm_base_url),
            llm_model=_clean_form_value(llm_model),
        )
        return summarize_text(text, runtime_config)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _clean_form_value(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


@app.get("/api/audio/file/{task_id}/{kind}")
def get_audio_file(task_id: str, kind: str) -> FileResponse:
    if kind not in {"original", "enhanced"}:
        raise HTTPException(status_code=404, detail="文件类型不存在")
    settings = get_settings()
    path = settings.outputs_dir / task_id / f"{kind}.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="音频文件不存在")
    return FileResponse(Path(path), media_type="audio/wav", filename=f"{kind}.wav")
