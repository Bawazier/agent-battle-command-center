import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [message]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t border-command-border bg-command-panel">
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Type a message...'}
        disabled={disabled}
        rows={1}
        className="flex-1 bg-command-bg border border-command-border rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-hud-green/50 disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !message.trim()}
        className="shrink-0 p-2 bg-hud-green/20 hover:bg-hud-green/30 border border-hud-green/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send className="w-5 h-5 text-hud-green" />
      </button>
    </div>
  );
}
