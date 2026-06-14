import dotenv from "dotenv";
import { z } from "zod";
import { ExportConfig } from "./types/export";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string(),
  API_PORT: z.string().transform(Number).default('3001'),
  API_HOST: z.string().default('0.0.0.0'),
  AGENTS_URL: z.string().default('http://localhost:8000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HUMAN_TIMEOUT_MINUTES: z.string().transform(Number).default('30'),
  API_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

// Parse CORS origins (comma-separated list)
const corsOrigins = parsed.data.CORS_ORIGINS
  ? parsed.data.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000']; // Default to localhost for development

export const config = {
  database: {
    url: parsed.data.DATABASE_URL,
  },
  server: {
    port: parsed.data.API_PORT,
    host: parsed.data.API_HOST,
  },
  agents: {
    url: parsed.data.AGENTS_URL,
  },
  auth: {
    apiKey: parsed.data.API_KEY,
  },
  cors: {
    origins: corsOrigins,
  },
  env: parsed.data.NODE_ENV,
  humanTimeoutMinutes: parsed.data.HUMAN_TIMEOUT_MINUTES,
};

export const EXPORT_CONFIGS: Record<string, ExportConfig> = {
  tasks: {
    modelName: "task",
    defaultFields: [
      "id",
      "title",
      "status",
      "complexity",
      "createdAt",
      "completedAt",
      "timeSpentMs",
    ],
    maxLimit: 500000,
    batchSize: 5000,
  },
  executionLogs: {
    modelName: "executionLog",
    defaultFields: ["id", "taskId", "step", "action", "observation"],
    maxLimit: 500000,
    batchSize: 5000,
  },
};
