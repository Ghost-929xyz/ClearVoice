# 实时录音转写 DLC 模块说明

## 目标

这个模块用于在不大幅改动主处理链路的前提下，补充“实时录音转文字”能力。实现方式是浏览器按短片段录音，后端逐段转码并复用现有 ASR 服务转写。

当前版本不是 WebSocket 流式识别，而是“分片准实时识别”：前端每 7 秒生成一个独立音频片段并提交给后端，后端返回该片段的文本后追加到页面。

## 新增文件

- `frontend/src/live/LiveTranscriptionPanel.tsx`
  - 独立前端录音组件。
  - 负责麦克风授权、MediaRecorder 分片、录音时长、音量估计、片段转写状态、合并文本展示。

- `backend/app/routes/live_transcription.py`
  - 独立后端路由。
  - 暴露 `POST /api/live/transcribe`。
  - 接收录音片段和 ASR 配置，并调用后端服务。

- `backend/app/services/live_transcription.py`
  - 独立后端服务。
  - 保存片段、调用 ffmpeg 转成 16 kHz WAV、复用现有 `transcribe_audio`。

- `docs/live-transcription-dlc.md`
  - 本说明文档。

## 修改的已有文件

- `frontend/src/main.tsx`
  - 删除旧的实时录音占位组件。
  - 引入 `LiveTranscriptionPanel`。
  - 把当前 ASR 配置 `settings` 传给实时转写组件。
  - ASR Model 使用自由文本输入框，按当前填写值传给后端。

- `frontend/src/styles.css`
  - 增加实时片段列表、合并文本、录音状态的样式。

- `backend/app/main.py`
  - 引入并挂载 `live_transcription_router`。

## 调用链路

```text
浏览器麦克风
  -> frontend/src/live/LiveTranscriptionPanel.tsx
  -> MediaRecorder 每 7 秒生成一个音频片段
  -> POST /api/live/transcribe
  -> backend/app/routes/live_transcription.py
  -> backend/app/services/live_transcription.py
  -> app.services.audio_io.convert_to_wav
  -> app.services.asr.transcribe_audio
  -> 返回片段文本
  -> 前端追加到实时转写列表和合并文本
```

## 后端接口

### 支线合并后的通用接口

除了原有 `POST /api/audio/process`，当前后端还合入了支线任务中的三个拆分接口：

- `POST /api/audio/enhance`
  - 只做上传、转码、语音增强、噪声分析和指标计算。
  - 表单字段：`file`、`atten_lim`。
  - 返回 `task_id`、原始/增强音频地址、噪声信息和指标。

- `POST /api/audio/transcribe`
  - 对已有任务的 `original` 或 `enhanced` 音频单独转写。
  - 表单字段：`task_id`、`kind`、`asr_provider`、`asr_api_key`、`asr_base_url`、`asr_model`。
  - 当 `asr_provider=xunfei` 时，还会读取 `xunfei_app_id`、`xunfei_api_key`、`xunfei_api_secret`。

- `POST /api/audio/summarize`
  - 对传入文本单独生成摘要。
  - 表单字段：`text`、`llm_api_key`、`llm_base_url`、`llm_model`。

`POST /api/audio/process` 仍然是主流程入口，但现在处理流程可组合配置：`enhance_audio` 控制是否生成增强音频，`transcribe_original` 控制是否转写原始音频，`transcribe_enhanced` 控制是否转写增强音频。默认会增强原音并转写增强音频，但跳过原始音频转写。

前端结果区会为可用的文本结果提供 `txt`、`doc`、`docx` 下载按钮。若本次没有启用原始音频转写，原始转写卡片只显示跳过说明，不显示下载按钮。

### `POST /api/live/transcribe`

请求类型：`multipart/form-data`

字段：

- `file`: 浏览器录音片段，通常是 `webm` 或 `mp4`
- `session_id`: 前端生成的会话 ID
- `sequence`: 片段序号，从 0 开始
- `asr_provider`: 复用主页面 ASR Provider，例如 `dashscope-fun-asr`
- `asr_api_key`: ASR Key
- `asr_base_url`: ASR Base URL
- `asr_model`: ASR Model
- `live_enhance`: 是否先增强实时录音片段，`true` 时先生成增强 WAV 再转写
- `atten_lim`: 实时增强使用的降噪强度，复用主页面增强参数
- `live_llm_optimize`: 是否使用大模型优化实时转写片段
- `live_topic`: 本次对话主题，供大模型修正术语、同音字和断句
- `llm_api_key`: LLM API Key
- `llm_base_url`: LLM Base URL
- `llm_model`: LLM Model
- `xunfei_app_id`: 讯飞 App ID，仅 `asr_provider=xunfei` 时需要
- `xunfei_api_key`: 讯飞 API Key，仅 `asr_provider=xunfei` 时需要
- `xunfei_api_secret`: 讯飞 API Secret，仅 `asr_provider=xunfei` 时需要

响应：

```json
{
  "session_id": "live-session-id",
  "sequence": 0,
  "text": "识别出的片段文本",
  "raw_text": "ASR 原始片段文本",
  "duration": 7.0,
  "enhanced": true,
  "optimized": true,
  "speaker_label": "说话人 A",
  "speaker_confidence": 0.82,
  "voice_activity": 0.74
}
```

## 复用的现有模块

- `app.services.audio_io.convert_to_wav`
  - 负责把浏览器录音片段转成后续 ASR 更稳定的 WAV。

- `app.services.audio_io.duration_seconds`
  - 返回转码后的片段时长。

- `app.services.enhance.enhance_speech_file`
  - 当 `live_enhance=true` 时，先增强实时录音片段，再把增强后的 WAV 交给 ASR。

- `app.services.llm.refine_live_transcript`
  - 当 `live_llm_optimize=true` 时，根据 `live_topic` 优化 ASR 片段文本。

- `app.services.speaker_profile.identify_dominant_speaker`
  - 对每个实时片段提取轻量声学特征，并在当前会话内聚类为 `说话人 A/B/C`。
  - 当前输出的是片段主导音色标签，不是逐词级专业说话人分离。

- `app.services.asr.transcribe_audio`
  - 复用现有 ASR 分发逻辑。
  - 因此实时转写天然支持当前已经接入的 ASR Provider。

- `app.schemas.RuntimeOpenAIConfig`
  - 复用主流程的 ASR 配置结构。

## 前端行为

- 点击“开始录音”后请求浏览器麦克风权限。
- 录音时显示：
  - 麦克风状态
  - 录音时长
  - 估算音量 dB
  - 每个片段的转写状态
- 点击“停止”后停止采集，但已提交的片段会继续等待后端返回。
- 点击“清空”会清除当前页面上的实时转写文本。
- 合并文本生成后，可直接下载为 `txt`、`doc` 或 `docx`。

## 当前限制

- 这是 HTTP 分片准实时方案，不是低延迟 WebSocket 流式 ASR。
- 每个片段都会单独调用一次 ASR，因此云端 ASR 会按片段产生调用成本。
- `local-whisper` 可用，但每段都加载/推理会比较慢，更适合后续优化为模型缓存或后台队列。
- 浏览器必须支持 `MediaRecorder` 和麦克风权限。
- 后端仍依赖 ffmpeg 转码。

## 后续可扩展方向

- 将 `/api/live/transcribe` 升级为 WebSocket。
- 后端缓存本地 Whisper 模型，降低 `local-whisper` 每段转写开销。
- 给实时片段加入 VAD，自动跳过静音片段。
- 将实时转写结果接入摘要模块，做“会议进行中摘要”。
