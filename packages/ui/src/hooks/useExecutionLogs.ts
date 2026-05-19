import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { executionLogsApi, type ExecutionLog } from '../api/client';

const SOCKET_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001';

interface FormattedLog {
  id: string;
  timestamp: Date;
  text: string;
  type: 'thought' | 'action' | 'result' | 'error' | 'loop';
  agentId?: string;
  taskId?: string;
}

export function useExecutionLogs(taskId: string | null) {
  const [logs, setLogs] = useState<FormattedLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const processedLogIds = useRef<Set<string>>(new Set());

  // Format a single execution log into display strings
  const formatExecutionLog = useCallback((log: ExecutionLog): FormattedLog[] => {
    const formatted: FormattedLog[] = [];
    const time = new Date(log.timestamp);
    const timeStr = time.toLocaleTimeString('en-US', { hour12: false });

    // Check if we've already processed this log
    if (processedLogIds.current.has(log.id)) {
      return [];
    }
    processedLogIds.current.add(log.id);

    if (log.thought) {
      formatted.push({
        id: `${log.id}-thought`,
        timestamp: time,
        text: `${timeStr} [Thought] ${log.thought.substring(0, 120)}${log.thought.length > 120 ? '...' : ''}`,
        type: 'thought',
        agentId: log.agentId,
        taskId: log.taskId,
      });
    }

    const inputStr = typeof log.actionInput === 'string'
      ? log.actionInput
      : JSON.stringify(log.actionInput).substring(0, 60);
    formatted.push({
      id: `${log.id}-action`,
      timestamp: time,
      text: `${timeStr} [${log.action}] ${inputStr}`,
      type: 'action',
      agentId: log.agentId,
      taskId: log.taskId,
    });

    const obsPreview = log.observation.substring(0, 100);
    if (log.observation.includes('SUCCESS') || log.observation.includes('Error') || log.observation.includes('failed')) {
      formatted.push({
        id: `${log.id}-result`,
        timestamp: time,
        text: `${timeStr} ${log.observation.includes('Error') || log.observation.includes('failed') ? '!' : '>'} ${obsPreview}`,
        type: log.observation.includes('Error') || log.observation.includes('failed') ? 'error' : 'result',
        agentId: log.agentId,
        taskId: log.taskId,
      });
    }

    if (log.isLoop) {
      formatted.push({
        id: `${log.id}-loop`,
        timestamp: time,
        text: `${timeStr} [LOOP DETECTED] Agent repeating actions`,
        type: 'loop',
        agentId: log.agentId,
        taskId: log.taskId,
      });
    }

    return formatted;
  }, []);

  // Load initial logs from API
  const loadInitialLogs = useCallback(async (taskIdToLoad: string) => {
    setIsLoading(true);
    processedLogIds.current.clear();

    try {
      const { items } = await executionLogsApi.getTaskLogs(taskIdToLoad);
      const formatted = items.flatMap(formatExecutionLog);
      setLogs(formatted);
    } catch (error) {
      console.error('Failed to load execution logs:', error);
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [formatExecutionLog]);

  // Subscribe to WebSocket events
  useEffect(() => {
    if (!taskId) {
      setLogs([]);
      return;
    }

    // Load initial logs
    loadInitialLogs(taskId);

    // Connect to WebSocket for real-time updates
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
    });

    socket.on('connect', () => {
      console.log('[useExecutionLogs] Socket connected');
    });

    // Listen for execution step events
    socket.on('execution_step', (event: { payload: {
      id: string;
      agentId: string;
      taskId: string;
      action: string;
      actionInput: unknown;
      observation: string;
      thought?: string;
      isLoop?: boolean;
      timestamp: string;
    } }) => {
      const payload = event.payload;

      // Only process logs for the current task
      if (payload.taskId !== taskId) return;

      const formatted = formatExecutionLog({
        id: payload.id || `ws-${Date.now()}`,
        agentId: payload.agentId,
        taskId: payload.taskId,
        step: 0,
        action: payload.action,
        actionInput: payload.actionInput,
        observation: payload.observation,
        thought: payload.thought,
        isLoop: payload.isLoop ?? false,
        timestamp: payload.timestamp || new Date().toISOString(),
      });

      if (formatted.length > 0) {
        setLogs(prev => [...prev, ...formatted].slice(-200)); // Keep last 200 entries
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [taskId, formatExecutionLog, loadInitialLogs]);

  // Filter functions
  const filterByAgent = useCallback((agentId: string) => {
    return logs.filter(log => log.agentId === agentId);
  }, [logs]);

  const filterByType = useCallback((type: FormattedLog['type']) => {
    return logs.filter(log => log.type === type);
  }, [logs]);

  const getErrorsOnly = useCallback(() => {
    return logs.filter(log => log.type === 'error' || log.type === 'loop');
  }, [logs]);

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([]);
    processedLogIds.current.clear();
  }, []);

  return {
    logs,
    isLoading,
    filterByAgent,
    filterByType,
    getErrorsOnly,
    clearLogs,
    refresh: () => taskId && loadInitialLogs(taskId),
  };
}
