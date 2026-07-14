import json

from openai import OpenAI

from app.config import get_settings
from app.schemas import RuntimeOpenAIConfig


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

    client = OpenAI(api_key=api_key, base_url=base_url)
    prompt = f"""
请基于以下转写文本输出严格 JSON，不要包含 Markdown。字段包括 summary、keywords、action_items。
文本：{text}
""".strip()
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
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
