import {z} from 'zod';
import {Prisma} from '@prisma/client';

export const ExportFormatEnum = z.enum(["csv", "json", "jsonl"]);
export type ExportFormat = z.infer<typeof ExportFormatEnum>;

export const ExportParamsSchema = z.object({
    format: ExportFormatEnum.default("csv"),
    taskId: z.string().uuid().optional(),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional()
});

export type ExportParams = z.infer<typeof ExportParamsSchema>;
export type PrismaModelName = Uncapitalize<Prisma.ModelName>;

export interface ExportConfig {
    modelName: PrismaModelName;
    defaultFields: string[];
    maxLimit?: number;
    batchSize?: number;
}