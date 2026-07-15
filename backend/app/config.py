from functools import lru_cache
from pathlib import Path
from shutil import which

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "ClearVoice API"
    data_dir: Path = BACKEND_DIR / "data"
    ffmpeg_path: str = "ffmpeg"
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    llm_model: str = "gpt-4o-mini"
    asr_model: str = "whisper-1"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.data_dir / "outputs"

    @property
    def resolved_ffmpeg_path(self) -> str:
        return resolve_ffmpeg_path(self.ffmpeg_path)


def resolve_ffmpeg_path(configured_path: str | None = None) -> str:
    configured_path = (configured_path or "ffmpeg").strip().strip("\"'")

    found_on_path = which(configured_path)
    if found_on_path:
        return found_on_path

    for candidate in _configured_path_candidates(configured_path):
        if candidate.is_file():
            return str(candidate)

    for candidate in _project_ffmpeg_candidates():
        if candidate.is_file():
            return str(candidate)

    return configured_path


def _configured_path_candidates(configured_path: str) -> list[Path]:
    raw_path = Path(configured_path).expanduser()
    roots = [Path.cwd(), _backend_root(), _project_root()]
    bases = [raw_path] if raw_path.is_absolute() else [root / raw_path for root in roots]
    return _ffmpeg_executable_candidates(bases)


def _project_ffmpeg_candidates() -> list[Path]:
    roots = [_project_root(), _backend_root()]
    package_roots = [
        root / folder
        for root in roots
        for folder in ("", "tools", "vendor", "bin")
    ]
    bases: list[Path] = []
    for root in package_roots:
        if not root.exists():
            continue
        bases.append(root / "ffmpeg")
        bases.extend(path for path in root.glob("ffmpeg*") if path.is_dir())
    return _ffmpeg_executable_candidates(bases)


def _ffmpeg_executable_candidates(bases: list[Path]) -> list[Path]:
    names = ("ffmpeg.exe", "ffmpeg")
    candidates: list[Path] = []
    seen: set[Path] = set()
    for base in bases:
        for candidate in [base, *(base / "bin" / name for name in names), *(base / name for name in names)]:
            normalized = candidate.resolve(strict=False)
            if normalized not in seen:
                seen.add(normalized)
                candidates.append(candidate)
    return candidates


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.outputs_dir.mkdir(parents=True, exist_ok=True)
    return settings
