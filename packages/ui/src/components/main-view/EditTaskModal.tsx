import { useState } from 'react';
import { X } from 'lucide-react';
import { useTasks } from '../../hooks/useTasks';
import type { Task, TaskType, TaskPriority, AgentType } from '@abcc/shared';

interface EditTaskModalProps {
  task: Task;
  onClose: () => void;
}

export function EditTaskModal({ task, onClose }: EditTaskModalProps) {
  const { updateTask, loading, error } = useTasks();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority as TaskPriority);

  // Read-only fields (not editable for existing tasks)
  const taskType = task.taskType as TaskType;
  const requiredAgent = task.requiredAgent as AgentType || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await updateTask(task.id, {
        title,
        description: description || undefined,
        priority,
      });
      onClose();
    } catch (err) {
      // Error is handled by the hook
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-command-panel border border-command-border rounded-lg w-full max-w-md">
        {/* Header */}
        <div className="p-4 border-b border-command-border flex items-center justify-between">
          <h2 className="font-display text-sm uppercase tracking-wider">Edit Task</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-command-accent rounded-sm transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-command-bg border border-command-border rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-hud-blue"
              placeholder="Task title..."
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-command-bg border border-command-border rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-hud-blue h-24 resize-none"
              placeholder="Task description..."
            />
          </div>

          {/* Type and Agent (read-only for existing tasks) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type</label>
              <select
                value={taskType}
                disabled
                className="w-full bg-command-accent border border-command-border rounded-sm px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              >
                <option value="code">Code</option>
                <option value="test">Test</option>
                <option value="review">Review</option>
                <option value="debug">Debug</option>
                <option value="refactor">Refactor</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Required Agent</label>
              <select
                value={requiredAgent}
                disabled
                className="w-full bg-command-accent border border-command-border rounded-sm px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              >
                <option value="">Any</option>
                <option value="coder">Coder</option>
                <option value="qa">QA</option>
              </select>
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Priority: {priority}
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) as TaskPriority)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-hud-red bg-hud-red/10 border border-hud-red/30 rounded-sm p-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn bg-command-accent text-gray-300 hover:bg-command-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title}
              className="flex-1 btn-primary disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
