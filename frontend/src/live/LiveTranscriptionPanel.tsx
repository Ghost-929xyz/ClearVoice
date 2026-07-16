import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eraser, Loader2, Mic2, Radio, Square } from 'lucide-react';
import { downloadTextFile, type DownloadFormat } from '../textDownloads';
import { apiUrl } from '../api';

export type LiveApiSettings = {
  asrProvider: string;
  asrApiKey: string;
  asrBaseUrl: string;
  asrModel: string;
  xunfeiAppId: string;
  xunfeiApiKey: string;
  xunfeiApiSecret: string;
  attenLim: number;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
};

type LiveSegment = {
  sequence: number;
  text: string;
  duration: number;
  status: 'pending' | 'done' | 'error';
  error?: string;
  optimized?: boolean;
  speakerLabel?: string;
  speakerConfidence?: number;
};

type SpeakerAliases = Record<string, string>;

const LIVE_CHUNK_MS = 7000;
const SPEAKER_ALIASES_KEY = 'clearvoice_live_speaker_aliases';

export function LiveTranscriptionPanel({ settings }: { settings: LiveApiSettings }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [volumeDb, setVolumeDb] = useState(-60);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [enhanceEnabled, setEnhanceEnabled] = useState(false);
  const [llmOptimizeEnabled, setLlmOptimizeEnabled] = useState(false);
  const [liveTopic, setLiveTopic] = useState('');
  const [speakerAliases, setSpeakerAliases] = useState<SpeakerAliases>(() => loadSpeakerAliases());

  const recordingRef = useRef(false);
  const enhanceEnabledRef = useRef(false);
  const llmOptimizeEnabledRef = useRef(false);
  const liveTopicRef = useRef('');
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef(0);
  const sessionIdRef = useRef('');
  const runIdRef = useRef(0);
  const sequenceRef = useRef(0);

  const transcriptText = useMemo(
    () => segments
      .filter((segment) => segment.status === 'done' && segment.text.trim())
      .sort((left, right) => left.sequence - right.sequence)
      .map((segment) => `${speakerDisplayName(segment.speakerLabel || fallbackSpeakerLabel(segment.sequence), speakerAliases)}：${segment.text.trim()}`)
      .join('\n'),
    [segments, speakerAliases]
  );

  useEffect(() => () => {
    recordingRef.current = false;
    stopRecorder();
    cleanupInput();
  }, []);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持麦克风录音或 MediaRecorder。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      recordingRef.current = true;
      runIdRef.current += 1;
      sessionIdRef.current = createSessionId();
      sequenceRef.current = 0;
      startTimeRef.current = Date.now();
      setSegments([]);
      setPendingCount(0);
      setElapsed(0);
      setVolumeDb(-60);
      setError(null);
      setRecording(true);
      startMeter(stream);
      startNextSegment();
    } catch (err) {
      setError(errorMessage(err));
      cleanupInput();
    }
  }

  function stopRecording() {
    recordingRef.current = false;
    runIdRef.current += 1;
    setRecording(false);
    setPendingCount(0);
    stopRecorder();
    cleanupInput();
  }

  function clearTranscript() {
    setSegments([]);
    setError(null);
  }

  function updateEnhanceEnabled(checked: boolean) {
    enhanceEnabledRef.current = checked;
    setEnhanceEnabled(checked);
  }

  function updateLlmOptimizeEnabled(checked: boolean) {
    llmOptimizeEnabledRef.current = checked;
    setLlmOptimizeEnabled(checked);
  }

  function updateLiveTopic(value: string) {
    liveTopicRef.current = value;
    setLiveTopic(value);
  }

  function renameSpeaker(label?: string) {
    if (!label) {
      return;
    }
    const currentName = speakerAliases[label] ?? '';
    const nextName = window.prompt(`为 ${label} 设置显示名称`, currentName);
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    setSpeakerAliases((current) => {
      const next = { ...current };
      if (trimmed) {
        next[label] = trimmed;
      } else {
        delete next[label];
      }
      saveSpeakerAliases(next);
      return next;
    });
  }

  function startNextSegment() {
    if (!recordingRef.current || !streamRef.current) {
      return;
    }

    const chunks: Blob[] = [];
    const mimeType = preferredMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    } catch (err) {
      setError(errorMessage(err));
      stopRecording();
      return;
    }

    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      setError('录音片段采集失败，请重新开始录音。');
    };
    recorder.onstop = () => {
      if (segmentTimerRef.current) {
        window.clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      const chunkType = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: chunkType });
      if (blob.size > 0) {
        const sequence = sequenceRef.current;
        const runId = runIdRef.current;
        sequenceRef.current += 1;
        void transcribeSegment(blob, sequence, chunkType, runId, sessionIdRef.current);
      }
      if (recordingRef.current) {
        startNextSegment();
      }
    };

    recorder.start();
    segmentTimerRef.current = window.setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, LIVE_CHUNK_MS);
  }

  async function transcribeSegment(blob: Blob, sequence: number, mimeType: string, runId: number, sessionId: string) {
    if (runId !== runIdRef.current) {
      return;
    }
    setPendingCount((count) => count + 1);
    setSegments((current) => upsertSegment(current, {
      sequence,
      text: '',
      duration: 0,
      status: 'pending',
    }));

    const form = new FormData();
    form.append('file', blob, `live-${sequence}.${extensionForMimeType(mimeType)}`);
    form.append('session_id', sessionId);
    form.append('sequence', String(sequence));
    form.append('asr_provider', settings.asrProvider.trim());
    form.append('asr_api_key', settings.asrApiKey.trim());
    form.append('asr_base_url', settings.asrBaseUrl.trim());
    form.append('asr_model', settings.asrModel.trim());
    form.append('xunfei_app_id', settings.xunfeiAppId.trim());
    form.append('xunfei_api_key', settings.xunfeiApiKey.trim());
    form.append('xunfei_api_secret', settings.xunfeiApiSecret.trim());
    form.append('live_enhance', String(enhanceEnabledRef.current));
    form.append('atten_lim', String(settings.attenLim));
    form.append('live_llm_optimize', String(llmOptimizeEnabledRef.current));
    form.append('live_topic', liveTopicRef.current.trim());
    form.append('llm_api_key', settings.llmApiKey.trim());
    form.append('llm_base_url', settings.llmBaseUrl.trim());
    form.append('llm_model', settings.llmModel.trim());

    try {
      const response = await fetch(apiUrl('/api/live/transcribe'), {
        method: 'POST',
        body: form,
      });
      const payload = await response.json();
      if (runId !== runIdRef.current || sessionId !== sessionIdRef.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(payload.detail || '实时转写失败');
      }
      const text = String(payload.text || '').trim();
      if (!text) {
        setSegments((current) => current.filter((segment) => segment.sequence !== sequence));
        return;
      }
      setSegments((current) => upsertSegment(current, {
        sequence,
        text,
        duration: Number(payload.duration || 0),
        status: 'done',
        optimized: Boolean(payload.optimized),
        speakerLabel: normalizeSpeakerLabel(payload.speaker_label, sequence),
        speakerConfidence: Number(payload.speaker_confidence || 0),
      }));
    } catch (err) {
      if (runId !== runIdRef.current || sessionId !== sessionIdRef.current) {
        return;
      }
      setSegments((current) => upsertSegment(current, {
        sequence,
        text: '',
        duration: 0,
        status: 'error',
        error: errorMessage(err),
      }));
    } finally {
      if (runId === runIdRef.current && sessionId === sessionIdRef.current) {
        setPendingCount((count) => Math.max(0, count - 1));
      }
    }
  }

  function startMeter(stream: MediaStream) {
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      meterTimerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);
      return;
    }

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    analyser.fftSize = 512;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);

    meterTimerRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      const db = rms > 0 ? Math.max(-60, Math.round(20 * Math.log10(rms))) : -60;
      setVolumeDb(db);
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 250);
  }

  function stopRecorder() {
    if (segmentTimerRef.current) {
      window.clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    recorderRef.current = null;
  }

  function cleanupInput() {
    if (meterTimerRef.current) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  }

  return (
    <section className="broadcastPanel livePanel">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow dark">Live Studio</p>
          <h2>实时录音转写</h2>
        </div>
        <span className={recording ? 'status active' : pendingCount > 0 ? 'status enabled' : 'status'}>
          {recording ? '录音中' : pendingCount > 0 ? '转写中' : '待机'}
        </span>
      </div>

      <div className="liveGrid">
        <div className="liveMetric">
          <span>麦克风</span>
          <strong>{recording ? '开启' : '待机'}</strong>
        </div>
        <div className="liveMetric">
          <span>时长</span>
          <strong>{formatTime(elapsed)}</strong>
        </div>
        <div className="liveMetric">
          <span>输入电平</span>
          <strong>{volumeDb} dBFS</strong>
        </div>
      </div>

      <label className="liveOptionToggle">
        <input type="checkbox" checked={enhanceEnabled} onChange={(event) => updateEnhanceEnabled(event.target.checked)} />
        <span>
          <strong>增强后转写</strong>
          <small>开启后，每个录音片段会先进行语音增强，再提交给 ASR；延迟会略有增加。</small>
        </span>
      </label>

      <div className="liveOptionGroup">
        <label className="liveOptionToggle">
          <input type="checkbox" checked={llmOptimizeEnabled} onChange={(event) => updateLlmOptimizeEnabled(event.target.checked)} />
          <span>
            <strong>大模型优化转写</strong>
            <small>开启后会根据主题修正常见错词、断句和术语；会增加一次 LLM 调用。</small>
          </span>
        </label>
        <label className="liveTopicInput">
          <span>本次对话主题</span>
          <input
            value={liveTopic}
            placeholder="例如：深度学习课程、项目例会、医学问诊..."
            disabled={!llmOptimizeEnabled}
            onChange={(event) => updateLiveTopic(event.target.value)}
          />
        </label>
      </div>

      <div className="liveTranscript transcriptStream">
        <Radio size={20} />
        <div>
          {segments.length === 0 ? (
            <span>点击开始录音后，系统会每 {LIVE_CHUNK_MS / 1000} 秒转写一段。</span>
          ) : (
            segments
              .sort((left, right) => left.sequence - right.sequence)
              .map((segment) => (
                <p key={segment.sequence} className={segment.status === 'error' ? 'segmentError' : ''}>
                  <small>#{segment.sequence + 1}</small>
                  <button
                    type="button"
                    className="speakerTag"
                    title={speakerTitle(segment, speakerAliases)}
                    onClick={() => renameSpeaker(segment.speakerLabel || fallbackSpeakerLabel(segment.sequence))}
                  >
                    {speakerDisplayName(segment.speakerLabel || fallbackSpeakerLabel(segment.sequence), speakerAliases)}
                  </button>
                  <em className={segment.optimized ? '' : 'empty'}>{segment.optimized ? 'AI' : ''}</em>
                  {segment.status === 'pending' && <span><Loader2 className="spin" size={14} /> 转写中...</span>}
                  {segment.status === 'done' && <span>{segment.text || '未识别到有效语音'}</span>}
                  {segment.status === 'error' && <span>{segment.error}</span>}
                </p>
              ))
          )}
        </div>
      </div>

      {transcriptText && (
        <div className="liveFinalText">
          <div className="textCardHeader">
            <span>合并文本</span>
            <DownloadButtons
              title="实时录音转写"
              text={transcriptText}
              baseName={`${sessionIdRef.current || 'live'}-live-transcript`}
            />
          </div>
          <p>{transcriptText}</p>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="broadcastActions">
        <button type="button" onClick={startRecording} disabled={recording}>
          <Mic2 size={18} />
          开始录音
        </button>
        <button type="button" className="ghost" onClick={stopRecording} disabled={!recording}>
          <Square size={16} />
          停止
        </button>
        <button type="button" className="ghost" onClick={clearTranscript} disabled={recording || segments.length === 0}>
          <Eraser size={16} />
          清空
        </button>
      </div>
    </section>
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

function preferredMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes('mp4')) {
    return 'mp4';
  }
  if (mimeType.includes('mpeg')) {
    return 'mp3';
  }
  return 'webm';
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function upsertSegment(segments: LiveSegment[], next: LiveSegment) {
  const others = segments.filter((segment) => segment.sequence !== next.sequence);
  return [...others, next].sort((left, right) => left.sequence - right.sequence);
}

function speakerDisplayName(label: string | undefined, aliases: SpeakerAliases) {
  if (!label) {
    return '说话人 ?';
  }
  return aliases[label] || label;
}

function speakerTitle(segment: LiveSegment, aliases: SpeakerAliases) {
  if (!segment.speakerLabel) {
    return `${fallbackSpeakerLabel(segment.sequence)}，后端暂未返回稳定音色标签`;
  }
  const confidence = Math.round((segment.speakerConfidence || 0) * 100);
  const displayName = speakerDisplayName(segment.speakerLabel, aliases);
  return displayName === segment.speakerLabel
    ? `${segment.speakerLabel}，置信度 ${confidence}%`
    : `${displayName}（${segment.speakerLabel}），置信度 ${confidence}%`;
}

function loadSpeakerAliases(): SpeakerAliases {
  try {
    const raw = window.localStorage.getItem(SPEAKER_ALIASES_KEY);
    return raw ? JSON.parse(raw) as SpeakerAliases : {};
  } catch {
    return {};
  }
}

function saveSpeakerAliases(aliases: SpeakerAliases) {
  try {
    window.localStorage.setItem(SPEAKER_ALIASES_KEY, JSON.stringify(aliases));
  } catch {
    // Local storage may be unavailable in private browsing; the in-memory name still works.
  }
}

function normalizeSpeakerLabel(value: unknown, sequence: number) {
  const label = String(value || '').trim();
  if (!label || label === '未识别') {
    return fallbackSpeakerLabel(sequence);
  }
  return label;
}

function fallbackSpeakerLabel(sequence: number) {
  const index = Math.max(0, sequence % 26);
  return `说话人 ${String.fromCharCode('A'.charCodeAt(0) + index)}`;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : '实时转写失败';
}
