import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, FileAudio, Loader2, Mic2, Sparkles, Upload } from 'lucide-react';
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
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
};

const SETTINGS_KEY = 'clearvoice_api_settings';
const asrProviders = [
  { value: 'local-whisper', label: 'local-whisper', baseUrl: '', model: 'medium', note: '本地 faster-whisper，ASR Key 可留空。' },
  { value: 'openai', label: 'OpenAI Whisper', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', note: 'OpenAI 官方 audio/transcriptions。' },
  { value: 'openai-compatible', label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', note: '用于支持 /v1/audio/transcriptions 的中转服务。' },
  { value: 'groq', label: 'Groq Whisper', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', note: 'Groq OpenAI-compatible 音频接口。' },
  { value: 'fireworks', label: 'Fireworks Whisper', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'whisper-v3', note: 'Fireworks OpenAI-compatible 音频接口。' },
  { value: 'dashscope', label: 'DashScope 预留', baseUrl: '', model: 'sensevoice-v1', note: '阿里云 SenseVoice/Paraformer 需要后端专用适配。' },
  { value: 'xunfei', label: '讯飞预留', baseUrl: '', model: 'iat', note: '讯飞需要 WebAPI 签名适配。' },
  { value: 'volcengine', label: '火山预留', baseUrl: '', model: 'bigmodel', note: '火山引擎需要专用签名/任务接口。' },
  { value: 'tencent', label: '腾讯云预留', baseUrl: '', model: '16k_zh', note: '腾讯云需要 SDK/签名适配。' },
  { value: 'baidu', label: '百度云预留', baseUrl: '', model: 'zh', note: '百度云需要 OAuth/REST 适配。' }
];
const defaultSettings: ApiSettings = {
  asrProvider: 'local-whisper',
  asrApiKey: '',
  asrBaseUrl: 'https://api.openai.com/v1',
  asrModel: 'medium',
  llmApiKey: '',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o-mini'
};

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ApiSettings>(defaultSettings);

  useEffect(() => {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return;
    }
    try {
      setSettings({ ...defaultSettings, ...JSON.parse(raw) });
    } catch {
      window.localStorage.removeItem(SETTINGS_KEY);
    }
  }, []);

  function saveSettings(next: ApiSettings) {
    setSettings(next);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  function clearSettings() {
    setSettings(defaultSettings);
    window.localStorage.removeItem(SETTINGS_KEY);
  }

  async function submit() {
    if (!file) {
      setError('请先选择一段音频或视频文件');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);
    form.append('asr_provider', settings.asrProvider.trim());
    form.append('asr_api_key', settings.asrApiKey.trim());
    form.append('asr_base_url', settings.asrBaseUrl.trim());
    form.append('asr_model', settings.asrModel.trim());
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
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">ClearVoice Hackathon MVP</p>
          <h1>嘈杂环境下的智能语音增强与转写系统</h1>
          <p className="heroText">上传课堂、会议或现场录音，系统会自动增强语音、估计噪声变化，并输出增强前后的转写对比。</p>
        </div>
        <div className="heroBadge">
          <Mic2 size={34} />
          <span>Noise-aware ASR</span>
        </div>
      </section>

      <section className="uploadCard">
        <label className="dropzone">
          <Upload size={28} />
          <span>{file ? file.name : '选择音频或视频文件'}</span>
          <input type="file" accept="audio/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button onClick={submit} disabled={loading || !file}>
          {loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {loading ? '正在处理...' : '开始增强与转写'}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <SettingsPanel settings={settings} onSave={saveSettings} onClear={clearSettings} />

      {result && <ResultView result={result} />}
    </main>
  );
}

function SettingsPanel({ settings, onSave, onClear }: { settings: ApiSettings; onSave: (settings: ApiSettings) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function update<K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) {
    if (key === 'asrProvider') {
      const provider = asrProviders.find((item) => item.value === value);
      setDraft((current) => ({
        ...current,
        asrProvider: String(value),
        asrBaseUrl: provider?.baseUrl ?? current.asrBaseUrl,
        asrModel: provider?.model ?? current.asrModel
      }));
      return;
    }
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const selectedAsrProvider = asrProviders.find((item) => item.value === draft.asrProvider);

  return (
    <section className="settingsCard">
      <div className="settingsHeader">
        <div>
          <p className="eyebrow dark">API Settings</p>
          <h2>分别配置 ASR 与 LLM</h2>
          <p>ASR 负责语音转写，LLM 负责摘要关键词。两组 Key 只保存在当前浏览器 localStorage，提交音频时随本次请求发送给后端。</p>
        </div>
        <span className={settings.asrProvider === 'local-whisper' || settings.asrApiKey || settings.llmApiKey ? 'status enabled' : 'status'}>
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
      <p className="settingsHint">{selectedAsrProvider?.note}</p>

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
        <button type="button" className="secondary" onClick={() => onSave(draft)}>保存到浏览器</button>
        <button type="button" className="ghost" onClick={onClear}>清除配置</button>
      </div>
    </section>
  );
}

function ResultView({ result }: { result: ProcessResult }) {
  const originalUrl = withCache(result.audio.original_url, result.task_id);
  const enhancedUrl = result.audio.enhanced_url ? withCache(result.audio.enhanced_url, result.task_id) : '';
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
        <Transcript title="原始转写" text={result.transcription.raw_text} />
        <Transcript title="增强后转写" text={result.transcription.enhanced_text} featured />
      </div>

      <div className="insightCard">
        <div className="cardTitle">
          <Activity size={20} />
          <h2>语义摘要</h2>
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

function Transcript({ title, text, featured = false }: { title: string; text: string; featured?: boolean }) {
  return (
    <div className={featured ? 'card transcript featured' : 'card transcript'}>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
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
