import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../types/index.js';
import type { ChatService } from '../services/chatService.js';
import { createLogger } from '../logger.js';

const log = createLogger('ChatRoute');

export const chatRouter: RouterType = Router();

const createConversationSchema = z.object({
  agentId: z.string().min(1),
  taskId: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1),
});

// List conversations
chatRouter.get('/conversations', asyncHandler(async (req, res) => {
  const chatService = req.app.get('chatService') as ChatService;
  const agentId = req.query.agentId as string | undefined;

  const conversations = await chatService.listConversations(agentId);
  res.json(conversations);
}));

// Create conversation
chatRouter.post('/conversations', asyncHandler(async (req, res) => {
  const chatService = req.app.get('chatService') as ChatService;
  const data = createConversationSchema.parse(req.body);

  const conversation = await chatService.createConversation(
    data.agentId,
    data.taskId,
    data.title
  );

  res.status(201).json(conversation);
}));

// Get conversation with messages
chatRouter.get('/conversations/:id', asyncHandler(async (req, res) => {
  const chatService = req.app.get('chatService') as ChatService;

  const conversation = await chatService.getConversation(req.params.id);

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  res.json(conversation);
}));

// Delete conversation
chatRouter.delete('/conversations/:id', asyncHandler(async (req, res) => {
  const chatService = req.app.get('chatService') as ChatService;

  try {
    await chatService.deleteConversation(req.params.id);
    res.status(204).send();
  } catch {
    res.status(404).json({ error: 'Conversation not found' });
  }
}));

// Send message (triggers streaming response)
chatRouter.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const chatService = req.app.get('chatService') as ChatService;
  const data = sendMessageSchema.parse(req.body);

  const conversation = await chatService.getConversation(req.params.id);

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  // Send message (this will stream via WebSocket)
  // Don't await - let it stream in the background
  chatService.sendMessage(req.params.id, data.content).catch((error) => {
    log.error('Error sending message', { error: String(error) });
  });

  // Return immediately - client will receive updates via WebSocket
  res.status(202).json({
    status: 'processing',
    conversationId: req.params.id,
  });
}));
