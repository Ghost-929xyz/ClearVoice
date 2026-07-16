import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, FileAudio, Loader2, Mic2, Sparkles, Upload } from 'lucide-react';
import './styles.css';

type AudioInfo = {
  original_url: string;
  enhanced_url: string | null;
  duration: number;
  sample_rate: number;
  original_peaks: number[];
  enhanced_peaks: number[];
};

type NoiseInfo = {
  noise_type: string;
  noise_label: string;
  confidence: number;
};

type Metrics = {
  snr_before: number;
  snr_after: number;
  snr_gain: number;
  noise_reduction_ratio: string;
  rms_before: number;
  rms_after: number;
  original_size_bytes: number;
  enhanced_size_bytes: number;
};

type LlmResult = {
  summary: string;
  keywords: string[];
  action_items: string[];
};

type EnhanceResult = {
  task_id: string;
  status: string;
  audio: AudioInfo;
  noise: NoiseInfo;
  metrics: Metrics;
};

type ProcessResult = EnhanceResult & {
  transcription: {
    raw_text: string;
    enhanced_text: string;
    raw_confidence: number | null;
    enhanced_confidence: number | null;
  };
  llm: LlmResult;
};

type ApiSettings = {
  asrProvider: string;
  asrApiKey: string;
  asrBaseUrl: string;
  asrModel: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  xunfeiAppId: string;
  xunfeiApiKey: string;
  xunfeiApiSecret: string;
  attenLim: number;
};

type ProgressState = {
  value: number;
  label: string;
  loading: boolean;
};

const SETTINGS_KEY = 'clearvoice_api_settings';
const asrProviders = [
  { value: 'local-whisper', label: 'local-whisper', baseUrl: '', model: 'medium', note: '本地 faster-whisper，ASR Key 可留空。' },
  { value: 'openai', label: 'OpenAI Whisper', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', note: 'OpenAI 官方 audio/transcriptions。' },
  { value: 'openai-compatible', label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', note: '用于支持 /v1/audio/transcriptions 的中转服务。' },
  { value: 'groq', label: 'Groq Whisper', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', note: 'Groq OpenAI-compatible 音频接口。' },
  { value: 'fireworks', label: 'Fireworks Whisper', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'whisper-v3', note: 'Fireworks OpenAI-compatible 音频接口。' },
  { value: 'dashscope-paraformer', label: '阿里 Paraformer/Fun-ASR 预留', baseUrl: '', model: 'paraformer-v2', note: '阿里录音文件识别 Paraformer/Fun-ASR，需要后端接入 DashScope 异步任务 API。' },
  { value: 'dashscope-qwen-audio', label: '阿里千问音频识别预留', baseUrl: '', model: 'qwen-audio-asr', note: '阿里录音文件识别-千问，需要后端接入 DashScope 千问音频接口。' },
  { value: 'xunfei', label: '讯飞 IAT', baseUrl: '', model: 'iat', note: '讯飞语音听写 IAT，需要填写 Xunfei App ID / API Key / API Secret。' },
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
  llmModel: 'gpt-4o-mini',
  xunfeiAppId: '',
  xunfeiApiKey: '',
  xunfeiApiSecret: '',
  attenLim: 20
};

const idleProgress = { value: 0, label: '等待开始', loading: false };

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<ApiSettings>(defaultSettings);
  const [enhanceResult, setEnhanceResult] = useState<EnhanceResult | null>(null);
  const [rawText, setRawText] = useState('已跳过原始音频转写。需要时可手动点击“转写原始音频”。');
  const [enhancedText, setEnhancedText] = useState('');
  const [llm, setLlm] = useState<LlmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enhanceProgress, setEnhanceProgress] = useState<ProgressState>(idleProgress);
  const [rawProgress, setRawProgress] = useState<ProgressState>(idleProgress);
  const [enhancedProgress, setEnhancedProgress] = useState<ProgressState>(idleProgress);
  const [summaryProgress, setSummaryProgress] = useState<ProgressState>(idleProgress);
  const [allProgress, setAllProgress] = useState<ProgressState>(idleProgress);

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
    saveSettings(defaultSettings);
  }

  function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setError(null);
    setEnhanceResult(null);
    setEnhancedText('');
    setRawText('已跳过原始音频转写。需要时可手动点击“转写原始音频”。');
    setLlm(null);
  }

  async function enhanceOnly() {
    if (!file) {
      setError('请先选择一段音频或视频文件');
      return null;
    }
    setError(null);
    setEnhanceProgress({ value: 12, label: '上传并转换音频', loading: true });
    const form = new FormData();
    form.append('file', file);
    form.append('atten_lim', String(settings.attenLim));
    try {
      const payload = await postForm<EnhanceResult>('/api/audio/enhance', form);
      setEnhanceProgress({ value: 100, label: '增强完成', loading: false });
      setEnhanceResult(payload);
      setEnhancedText('');
      setLlm(null);
      return payload;
    } catch (err) {
      setEnhanceProgress({ value: 100, label: '增强失败', loading: false });
      setError(errorMessage(err));
      return null;
    }
  }

  async function transcribe(kind: 'original' | 'enhanced', currentTaskId = enhanceResult?.task_id) {
    if (!currentTaskId) {
      setError('请先完成音频增强');
      return '';
    }
    const setProgress = kind === 'original' ? setRawProgress : setEnhancedProgress;
    setError(null);
    setProgress({ value: 20, label: kind === 'original' ? '转写原始音频' : '转写增强音频', loading: true });
    const form = asrForm(settings);
    form.append('task_id', currentTaskId);
    form.append('kind', kind);
    try {
      const payload = await postForm<{ text: string }>('/api/audio/transcribe', form);
      setProgress({ value: 100, label: '转写完成', loading: false });
      if (kind === 'original') {
        setRawText(payload.text);
      } else {
        setEnhancedText(payload.text);
      }
      return payload.text;
    } catch (err) {
      setProgress({ value: 100, label: '转写失败', loading: false });
      setError(errorMessage(err));
      return '';
    }
  }

  async function summarize(text = enhancedText) {
    if (!text.trim()) {
      setError('请先完成增强后转写，或输入可摘要的文本');
      return null;
    }
    setError(null);
    setSummaryProgress({ value: 30, label: '生成语义摘要', loading: true });
    const form = new FormData();
    form.append('text', text);
    form.append('llm_api_key', settings.llmApiKey.trim());
    form.append('llm_base_url', settings.llmBaseUrl.trim());
    form.append('llm_model', settings.llmModel.trim());
    try {
      const payload = await postForm<LlmResult>('/api/audio/summarize', form);
      setSummaryProgress({ value: 100, label: '摘要完成', loading: false });
      setLlm(payload);
      return payload;
    } catch (err) {
      setSummaryProgress({ value: 100, label: '摘要失败', loading: false });
      setError(errorMessage(err));
      return null;
    }
  }

  async function runAll() {
    if (!file) {
      setError('请先选择一段音频或视频文件');
      return;
    }
    setError(null);
    setAllProgress({ value: 8, label: '开始一键流程', loading: true });
    const form = new FormData();
    form.append('file', file);
    appendAllSettings(form, settings);
    try {
      setAllProgress({ value: 25, label: '增强音频', loading: true });
      const payload = await postForm<ProcessResult>('/api/audio/process', form);
      setAllProgress({ value: 88, label: '整理结果', loading: true });
      setEnhanceResult(payload);
      setRawText(payload.transcription.raw_text);
      setEnhancedText(payload.transcription.enhanced_text);
      setLlm(payload.llm);
      setAllProgress({ value: 100, label: '一键流程完成', loading: false });
    } catch (err) {
      setAllProgress({ value: 100, label: '一键流程失败', loading: false });
      setError(errorMessage(err));
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">ClearVoice Hackathon MVP</p>
          <h1>嘈杂环境下的智能语音增强与转写系统</h1>
          <p className="heroText">上传课堂、会议或现场录音，按需分步执行增强、转写和摘要，也可以一键完成完整流程。</p>
        </div>
        <div className="heroBadge">
          <Mic2 size={34} />
          <span>Modular Voice AI</span>
        </div>
      </section>

      <section className="uploadCard">
        <label
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            chooseFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <Upload size={28} />
          <span>{file ? file.name : '选择音频或视频文件，或直接拖入这里'}</span>
          <input type="file" accept="audio/*,video/*" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
        </label>
        <button onClick={runAll} disabled={!file || allProgress.loading || enhanceProgress.loading || enhancedProgress.loading || summaryProgress.loading}>
          {allProgress.loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          一键增强转写总结
        </button>
        {allProgress.loading && <ProgressBar progress={allProgress.value} label={allProgress.label} />}
        {error && <p className="error">{error}</p>}
      </section>

      <div className="moduleGrid">
        <EnhanceModule settings={settings} onSave={saveSettings} onClear={clearSettings} fileReady={!!file} progress={enhanceProgress} onEnhance={enhanceOnly} />
        <TranscribeModule settings={settings} onSave={saveSettings} onClear={clearSettings} hasEnhanced={!!enhanceResult} rawText={rawText} enhancedText={enhancedText} rawProgress={rawProgress} enhancedProgress={enhancedProgress} onRaw={() => transcribe('original')} onEnhanced={() => transcribe('enhanced')} />
        <SummaryModule settings={settings} onSave={saveSettings} onClear={clearSettings} text={enhancedText} result={llm} progress={summaryProgress} onSummarize={() => summarize()} />
      </div>

      {enhanceResult && <ResultView result={enhanceResult} rawText={rawText} enhancedText={enhancedText} llm={llm} />}
    </main>
  );
}

function EnhanceModule({ settings, onSave, onClear, fileReady, progress, onEnhance }: { settings: ApiSettings; onSave: (settings: ApiSettings) => void; onClear: () => void; fileReady: boolean; progress: ProgressState; onEnhance: () => void }) {
  return (
    <section className="settingsCard moduleCard">
      <ModuleHeader eyebrow="Enhance" title="音频增强" description="使用 DeepFilterNet 生成增强音频，并计算噪声和质量指标。" />
      <div className="settingsGrid">
        <label>
          <span>DeepFilterNet --atten-lim：{settings.attenLim}</span>
          <input type="range" min="0" max="100" step="1" value={settings.attenLim} onChange={(event) => onSave({ ...settings, attenLim: Number(event.target.value) })} />
        </label>
      </div>
      <button onClick={onEnhance} disabled={!fileReady || progress.loading}>{progress.loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}仅增强音频</button>
      {(progress.loading || progress.value > 0) && <ProgressBar progress={progress.value} label={progress.label} />}
      <ModuleActions onClear={onClear} />
    </section>
  );
}

function TranscribeModule({ settings, onSave, onClear, hasEnhanced, rawText, enhancedText, rawProgress, enhancedProgress, onRaw, onEnhanced }: { settings: ApiSettings; onSave: (settings: ApiSettings) => void; onClear: () => void; hasEnhanced: boolean; rawText: string; enhancedText: string; rawProgress: ProgressState; enhancedProgress: ProgressState; onRaw: () => void; onEnhanced: () => void }) {
  const provider = asrProviders.find((item) => item.value === settings.asrProvider);
  function update<K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) {
    if (key === 'asrProvider') {
      const nextProvider = asrProviders.find((item) => item.value === value);
      onSave({ ...settings, asrProvider: String(value), asrBaseUrl: nextProvider?.baseUrl ?? settings.asrBaseUrl, asrModel: nextProvider?.model ?? settings.asrModel });
      return;
    }
    onSave({ ...settings, [key]: value });
  }
  return (
    <section className="settingsCard moduleCard">
      <ModuleHeader eyebrow="ASR" title="语音转写" description="默认只转写增强音频；如需对比，可手动转写原始音频。" />
      <div className="settingsGrid">
        <label><span>ASR Provider</span><select value={settings.asrProvider} onChange={(event) => update('asrProvider', event.target.value)}>{asrProviders.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>ASR Model</span><input value={settings.asrModel} onChange={(event) => update('asrModel', event.target.value)} /></label>
        <label><span>ASR API Key</span><input type="password" value={settings.asrApiKey} placeholder="本地/讯飞可留空" onChange={(event) => update('asrApiKey', event.target.value)} /></label>
        <label><span>ASR Base URL</span><input value={settings.asrBaseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => update('asrBaseUrl', event.target.value)} /></label>
      </div>
      <p className="settingsHint">{provider?.note}</p>
      {settings.asrProvider === 'xunfei' && <div className="settingsGrid"><label><span>Xunfei App ID</span><input value={settings.xunfeiAppId} onChange={(event) => update('xunfeiAppId', event.target.value)} /></label><label><span>Xunfei API Key</span><input type="password" value={settings.xunfeiApiKey} onChange={(event) => update('xunfeiApiKey', event.target.value)} /></label><label><span>Xunfei API Secret</span><input type="password" value={settings.xunfeiApiSecret} onChange={(event) => update('xunfeiApiSecret', event.target.value)} /></label></div>}
      <div className="splitActions"><button onClick={onEnhanced} disabled={!hasEnhanced || enhancedProgress.loading}>转写增强音频</button><button className="ghost" onClick={onRaw} disabled={!hasEnhanced || rawProgress.loading}>转写原始音频</button></div>
      {(enhancedProgress.loading || enhancedProgress.value > 0) && <ProgressBar progress={enhancedProgress.value} label={enhancedProgress.label} />}
      {(rawProgress.loading || rawProgress.value > 0) && <ProgressBar progress={rawProgress.value} label={rawProgress.label} />}
      <div className="grid two"><Transcript title="原始转写" text={rawText} /><Transcript title="增强后转写" text={enhancedText || '尚未转写增强音频。'} featured /></div>
      <ModuleActions onClear={onClear} />
    </section>
  );
}

function SummaryModule({ settings, onSave, onClear, text, result, progress, onSummarize }: { settings: ApiSettings; onSave: (settings: ApiSettings) => void; onClear: () => void; text: string; result: LlmResult | null; progress: ProgressState; onSummarize: () => void }) {
  return (
    <section className="settingsCard moduleCard">
      <ModuleHeader eyebrow="LLM" title="语义摘要" description="基于增强后转写文本生成摘要、关键词和行动项。" />
      <div className="settingsGrid">
        <label><span>LLM API Key</span><input type="password" value={settings.llmApiKey} onChange={(event) => onSave({ ...settings, llmApiKey: event.target.value })} /></label>
        <label><span>LLM Base URL</span><input value={settings.llmBaseUrl} onChange={(event) => onSave({ ...settings, llmBaseUrl: event.target.value })} /></label>
        <label><span>LLM Model</span><input value={settings.llmModel} onChange={(event) => onSave({ ...settings, llmModel: event.target.value })} /></label>
      </div>
      <button onClick={onSummarize} disabled={!text.trim() || progress.loading}>{progress.loading ? <Loader2 className="spin" size={18} /> : <Activity size={18} />}生成摘要</button>
      {(progress.loading || progress.value > 0) && <ProgressBar progress={progress.value} label={progress.label} />}
      {result && <InsightCard result={result} />}
      <ModuleActions onClear={onClear} />
    </section>
  );
}

function ModuleHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="eyebrow dark">{eyebrow}</p><h2>{title}</h2><p className="settingsHint">{description}</p></div>;
}

function ModuleActions({ onClear }: { onClear: () => void }) {
  return <div className="settingsActions"><button type="button" className="ghost" onClick={onClear}>恢复默认配置</button></div>;
}

function ProgressBar({ progress, label }: { progress: number; label: string }) {
  return <div className="progressBox"><div className="progressMeta"><span>{label}</span><strong>{Math.round(progress)}%</strong></div><div className="progressTrack"><i style={{ width: `${progress}%` }} /></div></div>;
}

function ResultView({ result, rawText, enhancedText, llm }: { result: EnhanceResult; rawText: string; enhancedText: string; llm: LlmResult | null }) {
  const originalUrl = withCache(result.audio.original_url, result.task_id);
  const enhancedUrl = result.audio.enhanced_url ? withCache(result.audio.enhanced_url, result.task_id) : '';
  return (
    <section className="results">
      <div className="grid two"><AudioCard title="原始音频" url={originalUrl} peaks={result.audio.original_peaks} size={result.metrics.original_size_bytes} /><AudioCard title="增强音频" url={enhancedUrl} peaks={result.audio.enhanced_peaks} size={result.metrics.enhanced_size_bytes} featured /></div>
      <div className="grid four"><Metric label="噪声类型" value={result.noise.noise_label} hint={`置信度 ${Math.round(result.noise.confidence * 100)}%`} /><Metric label="SNR 提升" value={`${result.metrics.snr_gain} dB`} hint={`${result.metrics.snr_before} -> ${result.metrics.snr_after}`} /><Metric label="噪声抑制" value={result.metrics.noise_reduction_ratio} hint="基于噪声底估计" /><Metric label="音频时长" value={`${result.audio.duration}s`} hint={`${result.audio.sample_rate} Hz`} /></div>
      <div className="grid two"><Transcript title="原始转写" text={rawText} /><Transcript title="增强后转写" text={enhancedText || '尚未转写增强音频。'} featured /></div>
      {llm && <InsightCard result={llm} />}
    </section>
  );
}

function InsightCard({ result }: { result: LlmResult }) {
  return <div className="insightCard"><div className="cardTitle"><Activity size={20} /><h2>语义摘要</h2></div><p>{result.summary}</p><div className="chips">{result.keywords.length > 0 ? result.keywords.map((word) => <span key={word}>{word}</span>) : <span>暂无关键词</span>}</div>{result.action_items.length > 0 && <ul className="actions">{result.action_items.map((item) => <li key={item}>{item}</li>)}</ul>}</div>;
}

function AudioCard({ title, url, peaks, size, featured = false }: { title: string; url: string; peaks: number[]; size: number; featured?: boolean }) {
  return <div className={featured ? 'card featured' : 'card'}><div className="cardTitle"><FileAudio size={20} /><h2>{title}</h2></div><audio key={url} controls preload="metadata" src={url} /><Waveform peaks={peaks} /><div className="audioMeta"><span>文件大小：{formatBytes(size)}</span><a href={url} download>{title}下载</a></div></div>;
}

function Waveform({ peaks }: { peaks: number[] }) {
  return <div className="waveform" aria-label="音频波形摘要">{peaks.map((peak, index) => <i key={index} style={{ height: `${Math.max(8, peak * 58)}px` }} />)}</div>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function Transcript({ title, text, featured = false }: { title: string; text: string; featured?: boolean }) {
  return <div className={featured ? 'card transcript featured' : 'card transcript'}><h2>{title}</h2><p>{text}</p></div>;
}

function asrForm(settings: ApiSettings) {
  const form = new FormData();
  form.append('asr_provider', settings.asrProvider.trim());
  form.append('asr_api_key', settings.asrApiKey.trim());
  form.append('asr_base_url', settings.asrBaseUrl.trim());
  form.append('asr_model', settings.asrModel.trim());
  form.append('xunfei_app_id', settings.xunfeiAppId.trim());
  form.append('xunfei_api_key', settings.xunfeiApiKey.trim());
  form.append('xunfei_api_secret', settings.xunfeiApiSecret.trim());
  return form;
}

function appendAllSettings(form: FormData, settings: ApiSettings) {
  form.append('atten_lim', String(settings.attenLim));
  for (const [key, value] of asrForm(settings).entries()) {
    form.append(key, String(value));
  }
  form.append('llm_api_key', settings.llmApiKey.trim());
  form.append('llm_base_url', settings.llmBaseUrl.trim());
  form.append('llm_model', settings.llmModel.trim());
}

async function postForm<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, { method: 'POST', body: form });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || '请求失败');
  }
  return payload;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : '处理失败';
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
