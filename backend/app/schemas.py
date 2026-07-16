from pydantic import BaseModel


class RuntimeOpenAIConfig(BaseModel):
    asr_provider: str | None = None
    asr_api_key: str | None = None
    asr_base_url: str | None = None
    asr_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    xunfei_app_id: str | None = None
    xunfei_api_key: str | None = None
    xunfei_api_secret: str | None = None
    atten_lim: int = 20

    @property
    def has_asr_api_key(self) -> bool:
        return bool(self.asr_api_key and self.asr_api_key.strip())

    @property
    def has_llm_api_key(self) -> bool:
        return bool(self.llm_api_key and self.llm_api_key.strip())


class AudioInfo(BaseModel):
    original_url: str
    enhanced_url: str | None = None
    duration: float
    sample_rate: int
    original_peaks: list[float]
    enhanced_peaks: list[float]


class NoiseInfo(BaseModel):
    noise_type: str
    noise_label: str
    confidence: float


class Metrics(BaseModel):
    snr_before: float
    snr_after: float
    snr_gain: float
    noise_reduction_ratio: str
    rms_before: float
    rms_after: float
    original_size_bytes: int
    enhanced_size_bytes: int


class Transcription(BaseModel):
    raw_text: str
    enhanced_text: str
    raw_confidence: float | None = None
    enhanced_confidence: float | None = None


class LlmResult(BaseModel):
    summary: str
    keywords: list[str]
    action_items: list[str]


class EnhanceResult(BaseModel):
    task_id: str
    status: str
    audio: AudioInfo
    noise: NoiseInfo
    metrics: Metrics


class TranscribeResult(BaseModel):
    task_id: str
    kind: str
    text: str


class ProcessResult(BaseModel):
    task_id: str
    status: str
    audio: AudioInfo
    noise: NoiseInfo
    metrics: Metrics
    transcription: Transcription
    llm: LlmResult
