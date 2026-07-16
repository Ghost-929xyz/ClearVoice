import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ChevronDown, ChevronUp, Download, FileAudio, Loader2, Mic2, Settings2, Sparkles, Upload } from 'lucide-react';
import { LiveTranscriptionPanel } from './live/LiveTranscriptionPanel';
import { downloadTextFile, type DownloadFormat } from './textDownloads';
import './styles.css';

type ProcessResult = {
  task_id: string;
  status: string;
  audio: {
    original_url: string;
    enhanced_url: string | null;
    duration: number;
    sample_rate: number;
    original_peaks: number[];
    enhanced_peaks: number[];
  };
  noise: {
    noise_type: string;
    noise_label: string;
    confidence: number;
  };
  metrics: {
    snr_before: number;
    snr_after: number;
    snr_gain: number;
    noise_reduction_ratio: string;
    rms_before: number;
    rms_after: number;
    original_size_bytes: number;
    enhanced_size_bytes: number;
  };
  transcription: {
    raw_text: string;
    enhanced_text: string;
    raw_confidence: number | null;
    enhanced_confidence: number | null;
    raw_available?: boolean;
    enhanced_available?: boolean;
  };
  llm: {
    summary: string;
    keywords: string[];
    action_items: string[];
  };
};

type ApiSettings = {
  asrProvider: string;
  asrApiKey: string;
  asrBaseUrl: string;
  asrModel: string;
  xunfeiAppId: string;
  xunfeiApiKey: string;
  xunfeiApiSecret: string;
  attenLim: number;
  transcribeOriginal: boolean;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
};

type ProgressState = {
  percent: number;
  label: string;
  detail: string;
};

type AsrProviderOption = {
  value: string;
  label: string;
  baseUrl: string;
  model: string;
  note: string;
};

const SETTINGS_KEY = 'clearvoice_api_settings';
const asrProviders: AsrProviderOption[] = [
  {
    value: 'local-whisper',
    label: 'local-whisper',
    baseUrl: '',
    model: 'medium',
    note: '本地 faster-whisper，ASR Key 可留空。'
  },
  {
    value: 'openai',
    label: 'OpenAI Whisper',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    note: 'OpenAI 官方 audio/transcriptions。'
  },
  { value: 'openai-compatible', label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', note: '用于支持 /v1/audio/transcriptions 的中转服务。' },
  {
    value: 'groq',
    label: 'Groq Whisper',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    note: 'Groq OpenAI-compatible 音频接口。'
  },
  {
    value: 'fireworks',
    label: 'Fireworks Whisper',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    model: 'whisper-v3',
    note: 'Fireworks OpenAI-compatible 音频接口。'
  },
  {
    value: 'dashscope-fun-asr',
    label: '阿里 Fun-ASR',
    baseUrl: 'https://dashscope.aliyuncs.com',
    model: 'fun-asr-flash-2026-06-15',
    note: '阿里百炼 Fun-ASR Flash，同步识别本地上传音频。只需填写 API Key、Base URL、Model。'
  },
  { value: 'dashscope-qwen-audio', label: '阿里千问音频识别预留', baseUrl: '', model: 'qwen-audio-asr', note: '阿里录音文件识别-千问，需要后端接入 DashScope 千问音频接口。' },
  {
    value: 'xunfei',
    label: '讯飞 IAT',
    baseUrl: '',
    model: 'iat',
    note: '讯飞在线语音听写，填写 App ID、API Key、API Secret 三项即可调用。'
  },
  { value: 'volcengine', label: '火山预留', baseUrl: '', model: 'bigmodel', note: '火山引擎需要专用签名/任务接口。' },
  { value: 'tencent', label: '腾讯云预留', baseUrl: '', model: '16k_zh', note: '腾讯云需要 SDK/签名适配。' },
  { value: 'baidu', label: '百度云预留', baseUrl: '', model: 'zh', note: '百度云需要 OAuth/REST 适配。' }
];
const defaultSettings: ApiSettings = {
  asrProvider: 'local-whisper',
  asrApiKey: '',
  asrBaseUrl: 'https://api.openai.com/v1',
  asrModel: 'medium',
  xunfeiAppId: '',
  xunfeiApiKey: '',
  xunfeiApiSecret: '',
  attenLim: 20,
  transcribeOriginal: false,
  llmApiKey: '',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o-mini'
};

function restoreFunAsrDefault(settings: ApiSettings): ApiSettings {
  if (settings.asrProvider === 'dashscope-fun-asr' && settings.asrModel === 'qwen2-audio-instruct') {
    return { ...settings, asrModel: 'fun-asr-flash-2026-06-15' };
  }
  return settings;
}

function progressFromPercent(percent: number, asrProvider: string): ProgressState {
  const asrLabel = asrProviders.find((provider) => provider.value === asrProvider)?.label ?? 'ASR';
  const stages = [
    { percent: 0, label: '准备处理', detail: '正在准备上传音频。' },
    { percent: 10, label: '上传音频', detail: '正在把音频发送给后端。' },
    { percent: 22, label: '转码预处理', detail: '正在统一音频格式、采样率和声道。' },
    { percent: 40, label: '语音增强', detail: '正在降低噪声并生成增强音频。' },
    { percent: 56, label: '噪声分析', detail: '正在估计噪声类型、SNR 和音量指标。' },
    { percent: 74, label: '语音转写', detail: `正在调用 ${asrLabel} 识别增强后的音频。` },
    { percent: 88, label: '摘要生成', detail: '正在整理转写文本并生成摘要。' },
    { percent: 100, label: '处理完成', detail: '结果已经生成，正在展示。' }
  ];
  const activeStage = stages.reduce((active, stage) => (percent >= stage.percent ? stage : active), stages[0]);
  return { percent, label: activeStage.label, detail: activeStage.detail };
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ApiSettings>(defaultSettings);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return;
    }
    try {
      setSettings(restoreFunAsrDefault({ ...defaultSettings, ...JSON.parse(raw) }));
    } catch {
      window.localStorage.removeItem(SETTINGS_KEY);
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      return;
    }
    const interval = window.setInterval(() => {
      setProgress((current) => {
        const base = current ?? progressFromPercent(4, settings.asrProvider);
        const nextPercent = Math.min(92, Math.round(base.percent + Math.max(1, (92 - base.percent) * 0.06)));
        return progressFromPercent(nextPercent, settings.asrProvider);
      });
    }, 800);
    return () => window.clearInterval(interval);
  }, [loading, settings.asrProvider]);

  function saveSettings(next: ApiSettings) {
    setSettings(next);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  function clearSettings() {
    setSettings(defaultSettings);
    window.localStorage.removeItem(SETTINGS_KEY);
  }

  function isSupportedMediaFile(candidate: File) {
    if (candidate.type.startsWith('audio/') || candidate.type.startsWith('video/')) {
      return true;
    }
    return /\.(mp3|wav|m4a|webm|mp4|flac|ogg|aac)$/i.test(candidate.name);
  }

  function chooseFile(nextFile: File | null) {
    setProgress(null);
    setResult(null);
    if (!nextFile) {
      setFile(null);
      setError(null);
      return;
    }
    if (!isSupportedMediaFile(nextFile)) {
      setFile(null);
      setError('请拖入或选择音频/视频文件');
      return;
    }
    setFile(nextFile);
    setError(null);
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
  }

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!loading) {
      setDragActive(true);
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (loading) {
      return;
    }
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function submit() {
    if (!file) {
      setError('请先选择一段音频或视频文件');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(progressFromPercent(4, settings.asrProvider));

    const form = new FormData();
    form.append('file', file);
    form.append('asr_provider', settings.asrProvider.trim());
    form.append('asr_api_key', settings.asrApiKey.trim());
    form.append('asr_base_url', settings.asrBaseUrl.trim());
    form.append('asr_model', settings.asrModel.trim());
    form.append('xunfei_app_id', settings.xunfeiAppId.trim());
    form.append('xunfei_api_key', settings.xunfeiApiKey.trim());
    form.append('xunfei_api_secret', settings.xunfeiApiSecret.trim());
    form.append('atten_lim', String(settings.attenLim));
    form.append('transcribe_original', String(settings.transcribeOriginal));
    form.append('llm_api_key', settings.llmApiKey.trim());
    form.append('llm_base_url', settings.llmBaseUrl.trim());
    form.append('llm_model', settings.llmModel.trim());

    try {
      const response = await fetch('/api/audio/process', {
        method: 'POST',
        body: form
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || '处理失败');
      }
      setProgress(progressFromPercent(100, settings.asrProvider));
      setResult(payload);
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : '处理失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">ClearVoice Hackathon MVP</p>
          <h1>智能语音增强与转写工作台</h1>
          <p className="heroText">上传课堂、会议或现场录音，获得增强音频、噪声指标、转写文本和摘要结果。</p>
        </div>
        <div className="heroBadge">
          <Mic2 size={34} />
          <span>Noise-aware ASR</span>
        </div>
      </header>

      <section className="workspaceLayout">
        <div className="flowColumn">
          <section className="uploadCard processCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow dark">Audio Workflow</p>
                <h2>文件增强与转写</h2>
              </div>
              <span className={loading ? 'status active' : 'status enabled'}>{loading ? '处理中' : '就绪'}</span>
            </div>
            <label
              className={[
                'dropzone',
                dragActive ? 'dragActive' : '',
                loading ? 'disabled' : ''
              ].filter(Boolean).join(' ')}
              onDragEnter={handleDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload size={28} />
              <span>{file ? file.name : dragActive ? '松开以添加文件' : '拖入音频或视频文件，或点击选择'}</span>
              <input
                type="file"
                accept="audio/*,video/*"
                disabled={loading}
                onChange={handleFileInputChange}
              />
            </label>
            <button onClick={submit} disabled={loading || !file}>
              {loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              {loading ? '正在处理...' : '开始增强与转写'}
            </button>
            {progress && loading && <ProgressBar progress={progress} />}
            {error && <p className="error">{error}</p>}
          </section>

          <LiveTranscriptionPanel settings={settings} />
        </div>

        <SettingsPanel
          settings={settings}
          open={settingsOpen}
          onToggle={() => setSettingsOpen((open) => !open)}
          onSave={saveSettings}
          onClear={clearSettings}
        />
      </section>

      {result && <ResultView result={result} />}
    </main>
  );
}

function ProgressBar({ progress }: { progress: ProgressState }) {
  return (
    <div className="progressPanel" role="status" aria-live="polite">
      <div className="progressHeader">
        <span>{progress.label}</span>
        <strong>{progress.percent}%</strong>
      </div>
      <div className="progressTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
        <i style={{ width: `${progress.percent}%` }} />
      </div>
      <p>{progress.detail}</p>
    </div>
  );
}

function SettingsPanel({
  settings,
  open,
  onToggle,
  onSave,
  onClear
}: {
  settings: ApiSettings;
  open: boolean;
  onToggle: () => void;
  onSave: (settings: ApiSettings) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function applyDraft(next: ApiSettings) {
    setDraft(next);
    onSave(next);
  }

  function update<K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) {
    if (key === 'asrProvider') {
      const provider = asrProviders.find((item) => item.value === value);
      applyDraft({
        ...draft,
        asrProvider: String(value),
        asrBaseUrl: provider?.baseUrl ?? draft.asrBaseUrl,
        asrModel: provider?.model ?? draft.asrModel
      });
      return;
    }
    applyDraft({ ...draft, [key]: value });
  }

  const selectedAsrProvider = asrProviders.find((item) => item.value === draft.asrProvider);
  const savedAsrProvider = asrProviders.find((item) => item.value === settings.asrProvider);

  return (
    <aside className={open ? 'settingsCard configPanel open' : 'settingsCard configPanel'}>
      <button type="button" className="configToggle" onClick={onToggle} aria-expanded={open}>
        <span>
          <Settings2 size={20} />
          API 配置中心
        </span>
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>

      <div className="configSummary">
        <span>
          ASR
          <strong>{savedAsrProvider?.label ?? settings.asrProvider}</strong>
        </span>
        <span>
          LLM
          <strong>{settings.llmModel || '未配置'}</strong>
        </span>
        <span>
          降噪
          <strong>{settings.attenLim}</strong>
        </span>
        <span>
          原音
          <strong>{settings.transcribeOriginal ? '转写' : '跳过'}</strong>
        </span>
      </div>

      {open && (
        <div className="configBody">
          <div className="settingsHeader">
            <span className={settings.asrProvider === 'local-whisper' || settings.asrApiKey || settings.xunfeiApiKey || settings.llmApiKey ? 'status enabled' : 'status'}>
              {settings.asrProvider === 'local-whisper' ? '本地 ASR' : '云端 ASR'}
            </span>
          </div>

          <div className="settingsGroupTitle">ASR 转写配置</div>
          <div className="settingsGrid">
            <label>
              <span>ASR Provider</span>
              <select value={draft.asrProvider} onChange={(event) => update('asrProvider', event.target.value)}>
                {asrProviders.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
              </select>
            </label>
            <label>
              <span>ASR Model</span>
              <input value={draft.asrModel} placeholder={draft.asrProvider === 'local-whisper' ? 'medium' : 'whisper-1'} onChange={(event) => update('asrModel', event.target.value)} />
            </label>
            <label>
              <span>ASR API Key</span>
              <input type="password" value={draft.asrApiKey} placeholder="本地 ASR 可留空" onChange={(event) => update('asrApiKey', event.target.value)} />
            </label>
            <label>
              <span>ASR Base URL</span>
              <input value={draft.asrBaseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => update('asrBaseUrl', event.target.value)} />
            </label>
          </div>
          {draft.asrProvider === 'xunfei' && (
            <div className="settingsGrid xunfeiGrid">
              <label>
                <span>讯飞 App ID</span>
                <input value={draft.xunfeiAppId} placeholder="XUNFEI_APP_ID" onChange={(event) => update('xunfeiAppId', event.target.value)} />
              </label>
              <label>
                <span>讯飞 API Key</span>
                <input type="password" value={draft.xunfeiApiKey} placeholder="XUNFEI_API_KEY" onChange={(event) => update('xunfeiApiKey', event.target.value)} />
              </label>
              <label>
                <span>讯飞 API Secret</span>
                <input type="password" value={draft.xunfeiApiSecret} placeholder="XUNFEI_API_SECRET" onChange={(event) => update('xunfeiApiSecret', event.target.value)} />
              </label>
            </div>
          )}
          <p className="settingsHint">{selectedAsrProvider?.note}</p>

          <div className="settingsGroupTitle">增强参数</div>
          <div className="settingsGrid">
            <label className="rangeLabel">
              <span>降噪强度 atten_lim <strong>{draft.attenLim}</strong></span>
              <input type="range" min={0} max={100} value={draft.attenLim} onChange={(event) => update('attenLim', Number(event.target.value))} />
            </label>
            <label className="toggleLabel">
              <input type="checkbox" checked={draft.transcribeOriginal} onChange={(event) => update('transcribeOriginal', event.target.checked)} />
              <span>
                <strong>同时转写原始音频</strong>
                <small>开启后会多调用一次 ASR，耗时和云端费用也会增加。</small>
              </span>
            </label>
          </div>

          <div className="settingsGroupTitle">LLM 摘要配置</div>
          <div className="settingsGrid">
            <label>
              <span>LLM API Key</span>
              <input type="password" value={draft.llmApiKey} placeholder="sk-..." onChange={(event) => update('llmApiKey', event.target.value)} />
            </label>
            <label>
              <span>LLM Base URL</span>
              <input value={draft.llmBaseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => update('llmBaseUrl', event.target.value)} />
            </label>
            <label>
              <span>LLM Model</span>
              <input value={draft.llmModel} placeholder="gpt-4o-mini" onChange={(event) => update('llmModel', event.target.value)} />
            </label>
          </div>

          <div className="settingsActions">
            <button type="button" className="secondary" onClick={() => onSave(draft)}>已自动应用</button>
            <button type="button" className="ghost" onClick={onClear}>清除配置</button>
          </div>
        </div>
      )}
    </aside>
  );
}

function ResultView({ result }: { result: ProcessResult }) {
  const originalUrl = withCache(result.audio.original_url, result.task_id);
  const enhancedUrl = result.audio.enhanced_url ? withCache(result.audio.enhanced_url, result.task_id) : '';
  const rawDownloadable = result.transcription.raw_available ?? !isSkippedOriginalTranscript(result.transcription.raw_text);
  const enhancedDownloadable = result.transcription.enhanced_available ?? true;
  const summaryText = formatSummaryText(result.llm);
  return (
    <section className="results">
      <div className="grid two">
        <AudioCard title="原始音频" url={originalUrl} peaks={result.audio.original_peaks} size={result.metrics.original_size_bytes} />
        <AudioCard title="增强音频" url={enhancedUrl} peaks={result.audio.enhanced_peaks} size={result.metrics.enhanced_size_bytes} featured />
      </div>

      <div className="grid four">
        <Metric label="噪声类型" value={result.noise.noise_label} hint={`置信度 ${Math.round(result.noise.confidence * 100)}%`} />
        <Metric label="SNR 提升" value={`${result.metrics.snr_gain} dB`} hint={`${result.metrics.snr_before} -> ${result.metrics.snr_after}`} />
        <Metric label="噪声抑制" value={result.metrics.noise_reduction_ratio} hint="基于噪声底估计" />
        <Metric label="音频时长" value={`${result.audio.duration}s`} hint={`${result.audio.sample_rate} Hz`} />
      </div>

      <div className="grid two">
        <Transcript
          title="原始转写"
          text={result.transcription.raw_text}
          downloadable={rawDownloadable}
          baseName={`${result.task_id}-original-transcript`}
        />
        <Transcript
          title="增强后转写"
          text={result.transcription.enhanced_text}
          downloadable={enhancedDownloadable}
          baseName={`${result.task_id}-enhanced-transcript`}
          featured
        />
      </div>

      <div className="insightCard">
        <div className="textCardHeader">
          <div className="cardTitle">
            <Activity size={20} />
            <h2>语义摘要</h2>
          </div>
          <DownloadButtons title="语义摘要" text={summaryText} baseName={`${result.task_id}-summary`} />
        </div>
        <p>{result.llm.summary}</p>
        <div className="chips">
          {result.llm.keywords.length > 0 ? result.llm.keywords.map((word) => <span key={word}>{word}</span>) : <span>暂无关键词</span>}
        </div>
        {result.llm.action_items.length > 0 && (
          <ul className="actions">
            {result.llm.action_items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

function AudioCard({ title, url, peaks, size, featured = false }: { title: string; url: string; peaks: number[]; size: number; featured?: boolean }) {
  return (
    <div className={featured ? 'card featured' : 'card'}>
      <div className="cardTitle">
        <FileAudio size={20} />
        <h2>{title}</h2>
      </div>
      <audio key={url} controls preload="metadata" src={url} />
      <Waveform peaks={peaks} />
      <div className="audioMeta">
        <span>文件大小：{formatBytes(size)}</span>
        <a href={url} download>{title}下载</a>
      </div>
    </div>
  );
}

function Waveform({ peaks }: { peaks: number[] }) {
  return (
    <div className="waveform" aria-label="音频波形摘要">
      {peaks.map((peak, index) => <i key={index} style={{ height: `${Math.max(8, peak * 58)}px` }} />)}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function Transcript({
  title,
  text,
  baseName,
  downloadable = true,
  featured = false
}: {
  title: string;
  text: string;
  baseName: string;
  downloadable?: boolean;
  featured?: boolean;
}) {
  return (
    <div className={featured ? 'card transcript featured' : 'card transcript'}>
      <div className="textCardHeader">
        <h2>{title}</h2>
        {downloadable && <DownloadButtons title={title} text={text} baseName={baseName} />}
      </div>
      <p>{text}</p>
    </div>
  );
}

function DownloadButtons({ title, text, baseName }: { title: string; text: string; baseName: string }) {
  if (!text.trim()) {
    return null;
  }

  const formats: DownloadFormat[] = ['txt', 'doc', 'docx'];
  return (
    <div className="downloadButtons" aria-label={`${title}下载`}>
      {formats.map((format) => (
        <button
          key={format}
          type="button"
          className="downloadButton"
          title={`下载 ${title} 为 ${format.toUpperCase()}`}
          onClick={() => downloadTextFile(title, text, baseName, format)}
        >
          <Download size={14} />
          {format.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function formatSummaryText(llm: ProcessResult['llm']) {
  const actionItems = llm.action_items.length > 0
    ? llm.action_items.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '暂无行动项';
  return [
    llm.summary,
    '',
    `关键词：${llm.keywords.length > 0 ? llm.keywords.join('、') : '暂无关键词'}`,
    '',
    '行动项：',
    actionItems,
  ].join('\n');
}

function isSkippedOriginalTranscript(text: string) {
  return text.includes('已跳过原始音频转写');
}

function withCache(url: string, taskId: string) {
  return `${url}?t=${taskId}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

createRoot(document.getElementById('root')!).render(<App />);
