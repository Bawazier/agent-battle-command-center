import { useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { tasksApi, executionLogsApi, budgetApi, trainingDataApi } from '../../api/client';

interface ExportModalProps {
  source: 'tasks' | 'execution-logs' | 'budget' | 'training-data';
  onClose: () => void;
}

type Format = 'csv' | 'json' | 'jsonl';

export function ExportModal({ source, onClose }: ExportModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [format, setFormat] = useState<Format>(source === 'training-data' ? 'jsonl' : 'csv');
  const [range, setRange] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [taskType, setTaskType] = useState('');
  const [isGoodExample, setIsGoodExample] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titles: Record<string, string> = {
    tasks: 'Export Tasks',
    'execution-logs': 'Export Execution Logs',
    budget: 'Export Budget History',
    'training-data': 'Export Training Data',
  };
  const title = titles[source];

  const getRangeDates = (range: 'today' | 'week' | 'month' | 'all') => {
    if (range === 'all') return {};

    const now = new Date();
    const endDate = now.toISOString().slice(0, 10);

    if (range === 'today') return { startDate: endDate, endDate };

    const startDate = new Date(now);
    if (range === 'week') startDate.setDate(startDate.getDate() - 6);
    else if (range === 'month') startDate.setMonth(startDate.getMonth() - 1);

    return { startDate: startDate.toISOString().slice(0, 10), endDate };
  };

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      let blob: Blob;
      let filename: string;

      if (source === 'budget') {
        blob = await budgetApi.export({ range, format });
        filename = `budget-${range}-${today}.${format}`;
      } else if (source === 'training-data') {
        const params: Record<string, string> = { format: 'jsonl' };
        if (taskType) params.taskType = taskType;
        if (isGoodExample) params.isGoodExample = 'true';
        blob = await trainingDataApi.export(params);
        filename = `training-data-${today}.jsonl`;
      } else {
        const api = source === 'tasks' ? tasksApi : executionLogsApi;
        const { startDate, endDate } = getRangeDates(range);
        const payload: { format: string; startDate?: string; endDate?: string; taskId?: string } = {
          format,
          ...(range !== 'all' ? { startDate, endDate } : {}),
        };
        if (source === 'execution-logs' && taskId) {
          payload.taskId = taskId;
        }
        blob = await api.export(payload);
        const ext = format === 'jsonl' ? 'jsonl' : format;
        filename = `${source === 'tasks' ? 'tasks' : 'execution-logs'}-${range}-${today}.${ext}`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-xs" onClick={onClose} />

      <div className="relative bg-command-panel border border-command-border rounded-lg w-[420px] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-command-border bg-linear-to-r from-hud-green/5 to-transparent">
          <h2 className="font-display text-lg tracking-wider text-hud-green">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-command-accent rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Hidden for training-data — always JSONL */}
          {source !== 'training-data' && (
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                className="w-full px-3 py-2 bg-command-bg border border-command-border rounded-lg text-command-text text-sm focus:outline-none focus:border-hud-green"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="jsonl">JSONL</option>
              </select>
            </div>
          )}

          {(source === 'tasks' || source === 'budget') && (
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">Range</label>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as 'today' | 'week' | 'month' | 'all')}
                className="w-full px-3 py-2 bg-command-bg border border-command-border rounded-lg text-command-text text-sm focus:outline-none focus:border-hud-green"
              >
                <option value="today">Today</option>
                <option value="week">Last 7 days</option>
                <option value="month">Last 30 days</option>
                <option value="all">{source === 'budget' ? 'Last 90 days' : 'All'}</option>
              </select>
            </div>
          )}

          {source === 'budget' && range === 'all' && (
            <p className="text-xs text-gray-500 -mt-3">Maximum 90 days of history</p>
          )}

          {source === 'execution-logs' && (
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-2">
                Task ID <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                placeholder="uuid: 550e8400-e29b-41d4-a716-446655440000"
                className="w-full px-3 py-2 bg-command-bg border border-command-border rounded-lg text-command-text text-sm font-mono focus:outline-none focus:border-hud-green placeholder-gray-600"
              />
            </div>
          )}

          {source === 'training-data' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Task Type <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value)}
                  placeholder="e.g. code, test, review"
                  className="w-full px-3 py-2 bg-command-bg border border-command-border rounded-lg text-command-text text-sm focus:outline-none focus:border-hud-green placeholder-gray-600"
                />
              </div>
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isGoodExample}
                    onChange={(e) => setIsGoodExample(e.target.checked)}
                    className="w-4 h-4 rounded border-command-border bg-command-bg accent-hud-green"
                  />
                  <span className="text-sm text-gray-200">High-quality examples only</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-7">Only include examples marked as good for training</p>
              </div>
              <div className="p-3 bg-command-bg border border-command-border rounded-lg">
                <p className="text-xs text-gray-400">Format: <span className="text-hud-green font-mono">JSONL</span> (optimized for fine-tuning pipelines)</p>
              </div>
            </>
          )}

          {error && (
            <div className="p-3 bg-hud-red/10 border border-hud-red/30 rounded-lg text-sm text-hud-red">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-command-border">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-hud-green/20 text-hud-green border border-hud-green/30 rounded-lg hover:bg-hud-green/30 transition-colors text-sm disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {loading ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
