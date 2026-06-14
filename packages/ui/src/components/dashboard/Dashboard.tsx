import { useState, useEffect, useRef } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { CostDashboard } from './CostDashboard';
import { SuccessRateChart } from './SuccessRateChart';
import { AgentComparison } from './AgentComparison';
import { ComplexityDistribution } from './ComplexityDistribution';
import { MemoryApproval } from './MemoryApproval';
import { useTheme } from '../../themes/index';
import { ExportModal } from '../shared/ExportModal';

type ExportSource = 'execution-logs' | 'budget' | 'training-data';

const exportOptions: { source: ExportSource; label: string }[] = [
  { source: 'execution-logs', label: 'Execution Logs' },
  { source: 'budget', label: 'Budget History' },
  { source: 'training-data', label: 'Training Data' },
];

export function Dashboard() {
  const theme = useTheme();
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exportSource, setExportSource] = useState<ExportSource | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="h-full flex flex-col bg-command-bg overflow-auto p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-command-text mb-2">{theme.panels.dashboard}</h1>
          <p className="text-command-text-secondary">
            System-wide analytics and performance metrics
          </p>
        </div>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowExportDropdown(!showExportDropdown)}
            className="flex items-center gap-2 px-3 py-2 bg-command-accent border border-command-border rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Export data"
            aria-expanded={showExportDropdown}
            aria-haspopup="listbox"
          >
            <Download className="w-4 h-4" />
            Export
            <ChevronDown className={`w-4 h-4 transition-transform ${showExportDropdown ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>

          {showExportDropdown && (
            <div className="absolute right-0 top-full mt-1 bg-command-panel border border-command-border rounded-lg shadow-lg py-1 min-w-[200px] z-50">
              <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wider border-b border-command-border">
                Export Data
              </div>
              {exportOptions.map((opt) => (
                <button
                  key={opt.source}
                  onClick={() => {
                    setShowExportDropdown(false);
                    setExportSource(opt.source);
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-command-accent transition-colors text-gray-300 flex items-center gap-2"
                  role="option"
                  aria-selected={false}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {exportSource && (
        <ExportModal source={exportSource} onClose={() => setExportSource(null)} />
      )}

      {/* Main dashboard grid */}
      <div className="flex-1 grid grid-cols-2 gap-6">
        {/* Top row - Cost and Success Rate */}
        <div className="bg-command-surface border border-command-border rounded-lg p-6">
          <CostDashboard />
        </div>

        <div className="bg-command-surface border border-command-border rounded-lg p-6">
          <SuccessRateChart />
        </div>

        {/* Middle row - Agent Comparison and Complexity */}
        <div className="bg-command-surface border border-command-border rounded-lg p-6">
          <AgentComparison />
        </div>

        <div className="bg-command-surface border border-command-border rounded-lg p-6">
          <ComplexityDistribution />
        </div>

        {/* Bottom row - Agent Learnings (spans full width) */}
        <div className="col-span-2">
          <MemoryApproval />
        </div>
      </div>
    </div>
  );
}
