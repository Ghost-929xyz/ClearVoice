# ClearVoice

嘈杂环境下的智能语音增强与转写 Hackathon MVP。

系统支持上传音频或视频文件，后端会执行：

- `ffmpeg` 转码为 16 kHz 单声道 WAV
- 轻量语音增强：带通滤波、Wiener 降噪、软噪声门、归一化
- 噪声类型粗分类
- SNR 和噪声抑制比例估计
- 原始音频与增强音频转写对比
- LLM 摘要、关键词和行动项提取

未配置 `OPENAI_API_KEY` 时，系统仍可完成音频增强、指标计算和音频对比，但 ASR 与摘要会返回提示文本。

## 项目结构

```text
backend/
  app/
    main.py              FastAPI 入口
    services/
      pipeline.py        主处理链路
      enhance.py         轻量语音增强
      metrics.py         SNR 与噪声抑制估计
      noise.py           噪声类型粗分类
      asr.py             Whisper API 转写
      llm.py             摘要与关键词
frontend/
  src/main.tsx           React 页面
  src/styles.css         页面样式
```

## 环境要求

- Python 3.11+
- Node.js 18+
- `ffmpeg`

Windows 可通过 `winget install Gyan.FFmpeg` 安装 ffmpeg。

## 后端启动

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

可选环境变量：

```bash
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
ASR_MODEL=whisper-1
LLM_MODEL=gpt-4o-mini
FFMPEG_PATH=ffmpeg
```

如果使用兼容 OpenAI SDK 的模型服务，可以设置 `OPENAI_BASE_URL`。

## 前端启动

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`。

## API

```text
GET  /api/health
POST /api/audio/process
GET  /api/audio/file/{task_id}/original
GET  /api/audio/file/{task_id}/enhanced
```

`POST /api/audio/process` 使用 `multipart/form-data`，字段名为 `file`。

## Demo 建议

准备三类音频：

- 会议录音叠加键盘声
- 课堂录音叠加人群聊天声
- 户外录音叠加风噪或车流声

答辩展示顺序：

1. 上传嘈杂录音
2. 播放原始音频
3. 播放增强音频
4. 展示噪声类型、SNR 提升、噪声抑制比例
5. 对比原始转写和增强后转写
6. 展示摘要和关键词

## 后续增强方向

- 替换 `enhance.py` 为 DeepFilterNet、RNNoise 或 SpeechBrain MetricGAN+
- 加入 faster-whisper 本地转写，降低 API 依赖
- 增加频谱图和波形图可视化
- 增加异步任务队列，支持长音频处理进度
- 引入 YAMNet/PANNs 做更准确的噪声事件识别
