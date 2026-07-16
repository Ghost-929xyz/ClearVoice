import json
import os

from openai import OpenAI

from app.config import get_settings
from app.schemas import RuntimeOpenAIConfig

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


LLM_TIMEOUT_SECONDS = max(5, _env_int("CLEARVOICE_LLM_TIMEOUT", 30))
LLM_MAX_TRANSCRIPT_CHARS = max(1000, _env_int("CLEARVOICE_LLM_MAX_TRANSCRIPT_CHARS", 12000))


def summarize_transcript(text: str, runtime_config: RuntimeOpenAIConfig | None = None) -> dict:
    settings = get_settings()
    api_key = (runtime_config.llm_api_key if runtime_config else None) or settings.openai_api_key
    base_url = (runtime_config.llm_base_url if runtime_config else None) or settings.openai_base_url
    model = (runtime_config.llm_model if runtime_config else None) or settings.llm_model
    fallback = {
        "summary": "已完成本地音频增强、噪声分析和质量指标计算。配置 OPENAI_API_KEY 后可进一步生成真实语音转写、摘要和关键词。",
        "keywords": ["语音增强", "噪声分析", "SNR", "本地处理"],
        "action_items": [],
    }
    if not api_key or text.startswith("未配置"):
        return fallback

    summary_text = _trim_transcript_for_summary(text)
    prompt = f"""
请基于以下转写文本输出严格 JSON，不要包含 Markdown。字段包括 summary、keywords、action_items。
文本：{summary_text}
""".strip()
    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=LLM_TIMEOUT_SECONDS)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
    except Exception as exc:
        return {
            "summary": f"转写已完成，但摘要生成失败或超时：{exc}",
            "keywords": [],
            "action_items": [],
        }
    content = response.choices[0].message.content or "{}"
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {"summary": content, "keywords": [], "action_items": []}
    return {
        "summary": str(data.get("summary", "")),
        "keywords": [str(item) for item in data.get("keywords", [])],
        "action_items": [str(item) for item in data.get("action_items", [])],
    }


def _trim_transcript_for_summary(text: str) -> str:
    cleaned = text.strip()
    if len(cleaned) <= LLM_MAX_TRANSCRIPT_CHARS:
        return cleaned
    return cleaned[:LLM_MAX_TRANSCRIPT_CHARS] + "\n\n[后续转写文本因长度过长已截断，摘要基于前半部分生成。]"


def refine_live_transcript(text: str, topic: str | None = None, runtime_config: RuntimeOpenAIConfig | None = None) -> str:
    cleaned = text.strip()
    if not cleaned:
        return ""

    settings = get_settings()
    api_key = (runtime_config.llm_api_key if runtime_config else None) or settings.openai_api_key
    base_url = (runtime_config.llm_base_url if runtime_config else None) or settings.openai_base_url
    model = (runtime_config.llm_model if runtime_config else None) or settings.llm_model
    if not api_key:
        return cleaned

    topic_hint = (topic or "").strip() or "未提供"
    prompt = f"""
你是实时语音转写校对助手。请根据“本次对话主题”修正 ASR 片段中的明显错词、同音字、专有名词和标点断句。
要求：
1. 只输出修正后的片段文本，不要输出解释、JSON 或 Markdown。
2. 不要扩写，不要编造原文中没有的信息。
3. 如果片段已经合理，原样返回。

本次对话主题：{topic_hint}
ASR 片段：{cleaned}
""".strip()
    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=30)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )
    except Exception:
        return cleaned
    content = (response.choices[0].message.content or "").strip()
    return content or cleaned
