# ClearVoice

嘈杂环境下的智能语音增强与转写系统。

上传课堂、会议或现场录音，系统自动完成语音增强、噪声分析、语音转写与摘要提取，并对比增强前后的音频与文本质量。

## 处理链路

```text
上传音频/视频
  ↓
ffmpeg 转码为 16 kHz 单声道 WAV
  ↓
DeepFilterNet 语音增强
  ↓
噪声类型粗分类
  ↓
SNR / 噪声抑制比例 / RMS 指标计算
  ↓
原始音频 + 增强音频 → ASR 转写
  ↓
LLM 摘要、关键词、行动项提取
  ↓
前端展示播放器、波形、指标、转写对比、摘要
```

---

## 硬件与系统要求

| 需求 | 最低配置 | 推荐配置 |
|---|---|---|
| 操作系统 | Windows 10 | Windows 10 / 11 |
| Python | 3.11 | 3.11 |
| Node.js | 18+ | 18+ |
| ffmpeg | 必须 | 必须 |
| 内存 | 8 GB | 16 GB |
| CPU | 4 核 | 8 核以上 |
| GPU | 无（CPU 可跑） | NVIDIA 6 GB+ 显存 |
| 磁盘 | 5 GB | 10 GB+ |

> **注意**：项目目前依赖 DeepFilterNet（依赖 PyTorch）和 faster-whisper 本地模型，首次安装与模型下载会占用数 GB 空间并需要稳定网络。

## GPU 说明

- **DeepFilterNet** 当前版本强制使用 CPU（部分新 GPU 架构如 RTX 5060 上 PyTorch CUDA kernel 不兼容）。
- **faster-whisper** 本地 ASR 可用 CPU 或 NVIDIA GPU。有 NVIDIA 显卡时建议使用 `medium` 模型；无 GPU 电脑建议用 `small`。
- **LLM** 摘要走云端 API，不需要本地 GPU。

---

## 快速开始（Windows）

### 一键启动

1. 安装前置软件：

```powershell
winget install Python.Python.3.11
winget install OpenJS.NodeJS
winget install Gyan.FFmpeg
```

安装完成后**重新打开 PowerShell**。

2. 克隆项目并切换到开发分支：

```powershell
git clone https://github.com/Ghost-929xyz/ClearVoice.git
cd ClearVoice
git switch feature/add_bat_version
```

3. 双击启动脚本 或在 PowerShell 运行：

```powershell
.\start_clearvoice.bat
```

脚本会完成：
- 创建 `backend\.venv`
- 安装后端依赖
- 安装前端依赖
- 启动后端与前端
- 自动打开浏览器

4. 访问 `http://localhost:5173` 上传音频。

### 手动启动

如果不想用一键脚本，可以分步启动。

#### 后端（必须用 Python 3.11）

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip setuptools
python -m pip install "wheel<0.47"
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

#### 前端

```powershell
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`。

### 桌面版（Electron）

项目已提供 Electron + Python backend 桌面壳，保留现有 React 前端和 FastAPI 后端。

首次运行建议先执行一次普通启动脚本，确保后端虚拟环境和依赖已安装：

```powershell
.\start_clearvoice.bat
```

然后启动桌面版：

```powershell
.\start_clearvoice_desktop.bat
```

桌面版会自动：

- 构建 `frontend/dist`
- 启动本地 FastAPI backend
- 打开 Electron 桌面窗口

也可以手动运行：

```powershell
cd desktop
npm install
npm run start
```

如需生成安装包或绿色版：

```powershell
cd desktop
npm run dist
```

---

## ffmpeg 安装说明

### 方式 1：winget

```powershell
winget install Gyan.FFmpeg
```

### 方式 2：手动解压

下载 https://www.gyan.dev/ffmpeg/builds/ 的 `ffmpeg-release-essentials.zip`，解压到任一目录。

后端会自动查找以下位置：

```text
ClearVoice/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe
ClearVoice/tools/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe
ClearVoice/backend/tools/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe
```

### 方式 3：在 `backend/.env` 里显式配置

```env
FFMPEG_PATH=C:\tools\ffmpeg\bin\ffmpeg.exe
```

验证（任意终端）：

```powershell
ffmpeg -version
```

---

## 前端 ASR 与 LLM 配置

打开 `http://localhost:5173` 后页面底部有配置面板。

### ASR 转写

| Provider | 说明 | 推荐模型 | 是否需要 API Key |
|---|---:|---|---|
| `local-whisper` | 本地 faster-whisper，无需网络 | `small` / `medium` | 否 |
| `openai` | OpenAI 官方音频转写 | `whisper-1` | 是 |
| `openai-compatible` | 兼容 OpenAI audio/transcriptions 的中转 | 服务商模型名 | 是 |
| `groq` | Groq Whisper | `whisper-large-v3-turbo` | 是 |
| `fireworks` | Fireworks Whisper | `whisper-v3` | 是 |
| `dashscope-paraformer` | 阿里云录音文件识别 Paraformer | `paraformer-v2` | 预留，待适配 |
| `dashscope-qwen-audio` | 阿里云录音文件识别-千问 | `qwen-audio-asr` | 预留，待适配 |
| `xunfei` / `volcengine` / `tencent` / `baidu` | 各厂商 ASR | 各厂商模型名 | 预留，待适配 |

### LLM 摘要

```text
LLM API Key: 你的 key
LLM Base URL: 服务商 /v1 地址
LLM Model: 聊天模型名
```

如果同时留空，系统只做音频增强和本地分析，不生成 AI 摘要。

### 推荐新手配置

先验证全流程：

```text
ASR Provider: local-whisper
ASR Model: small
ASR API Key: 留空
ASR Base URL: 保持默认

LLM API Key: 留空
LLM Base URL: 保持默认
LLM Model: gpt-4o-mini
```

上传 30-60 秒音频，确认增强和转写都跑通后，再按需配置 LLM API Key。

---

## 支持的音频格式

```text
mp3  wav  m4a  webm  mp4  flac  ogg  aac
```

上传时浏览器会过滤为 `audio/*, video/*`，后端 ffmpeg 负责统一转码。

---

## API 接口

```text
GET  /api/health
POST /api/audio/process
GET  /api/audio/file/{task_id}/original
GET  /api/audio/file/{task_id}/enhanced
```

`POST /api/audio/process` 参数（`multipart/form-data`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `file` | file | 音频/视频文件 |
| `asr_provider` | string | ASR 提供商 |
| `asr_api_key` | string | ASR API Key |
| `asr_base_url` | string | ASR Base URL |
| `asr_model` | string | ASR 模型名 |
| `enhance_audio` | bool | 是否生成增强音频，默认 `true` |
| `transcribe_original` | bool | 是否转写原始音频，默认 `false` |
| `transcribe_enhanced` | bool | 是否转写增强音频，默认 `true` |
| `atten_lim` | int | 降噪强度，默认 `20` |
| `llm_api_key` | string | LLM API Key |
| `llm_base_url` | string | LLM Base URL |
| `llm_model` | string | LLM 模型名 |

---

## 项目结构

```text
ClearVoice/
├── start_clearvoice.bat   一键启动脚本
├── README.md
├── backend/
│   ├── .env.example       环境变量示例
│   ├── requirements.txt    Python 依赖
│   ├── app/
│   │   ├── main.py        FastAPI 入口
│   │   ├── config.py      配置读取
│   │   ├── schemas.py     数据模型
│   │   └── services/
│   │       ├── pipeline.py     主处理链路
│   │       ├── enhance.py      DeepFilterNet 语音增强
│   │       ├── asr.py          语音转写分发
│   │       ├── llm.py          摘要与关键词
│   │       ├── audio_io.py     ffmpeg 与音频读写
│   │       ├── metrics.py      SNR / RMS / 波形峰值
│   │       └── noise.py        噪声类型粗分类
│   └── data/              运行时上传/输出目录
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx        React 页面与配置组件
        ├── styles.css      样式
        └── vite-env.d.ts  Vite 类型声明
```

---

## 常见问题

### 1. 后端提示"未安装 ffmpeg"

检查 `backend/.env` 里 `FFMPEG_PATH` 是否正确：

```powershell
cd backend
python -c "from app.config import get_settings; import os; s=get_settings(); print(s.ffmpeg_path, os.path.exists(s.ffmpeg_path))"
```

如果返回 `False`，需要配置正确路径。

### 2. faster-whisper 模型下载失败

设置 Hugging Face 镜像：

```powershell
$env:HF_ENDPOINT="https://hf-mirror.com"
$env:HF_HUB_DISABLE_XET="1"
python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"
```

或先下载 `small` 模型，再切回页面上传。

### 3. DeepFilterNet 安装失败

确保使用 Python 3.11 虚拟环境：

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --no-cache-dir -r requirements.txt
```

如果依然失败，可先单独安装 PyTorch：

```powershell
python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
python -m pip install deepfilternet
```

### 4. 页面一直转圈 / Failed to fetch

说明后端没启动或没按正确 Python 环境启动。

确保在已激活 `.venv` 后用完整路径启动：

```powershell
& "C:\Users\...\ClearVoice\backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

不要直接使用全局 `python` 或 `uvicorn` 命令。

### 5. Mac / Linux 兼容性

项目目前主要经过 Windows 验证。Mac / Linux 可以运行，但需要注意：

- 后端必须使用 Python 3.11
- `start_clearvoice.bat` 不能用于 Mac/Linux，需手动启动前后端
- 文件路径使用正斜杠而非反斜杠
- ffmpeg 通过包管理器安装：

```bash
# macOS
brew install ffmpeg

# Ubuntu
sudo apt install ffmpeg
```

### 6. 音频总长度建议

当前是同步 HTTP 处理，建议 Demo 音频：

```text
30 - 90 秒
```

5 分钟以上的音频处理时间可能达到数分钟。

---

## Demo 展示建议

### 准备测试音频

- 会议录音叠加键盘声
- 课堂录音叠加人群聊天声
- 户外录音叠加风噪或车流声

### 答辩展示顺序

1. 上传嘈杂录音
2. 播放原始音频
3. 播放增强音频
4. 展示噪声类型、SNR 提升、噪声抑制比例
5. 对比原始转写和增强后转写
6. 展示摘要和关键词

---

## 后续增强方向

- DashScope / 讯飞 / 火山 / 腾讯 / 百度 ASR 专用 API 适配
- 异步任务队列，支持长音频处理进度
- 参数可配置的增强模型切换（DeepFilterNet / RNNoise / MetricGAN+）
- DeepFilterNet GPU 推理
- 频谱图和波形图可视化
- YAMNet / PANNs 噪声事件细粒度识别
- 说话人分离
- WebSocket 实时音频流增强
