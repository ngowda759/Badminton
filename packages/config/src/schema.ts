import { z } from 'zod';

import { ConfigurationError } from './errors.ts';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_API_PORT = 3000;
export const DEFAULT_WEB_PORT = 5173;

/** Ports must be usable TCP ports; `0` (random) is not valid for a long-running server. */
const portSchema = z.coerce.number().int().min(1).max(65_535);

/**
 * Rejects connection strings that embed a password. Credentials are supplied
 * out of band (docker-compose / Supabase secrets) and must never be committed.
 */
const databaseUrlSchema = z
  .string()
  .min(1, 'DATABASE_URL must not be empty')
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'DATABASE_URL must use the postgresql:// or postgres:// scheme',
  });

/** Server-side configuration. Must never be bundled into browser code. */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  API_PORT: portSchema.default(DEFAULT_API_PORT),
  DATABASE_URL: databaseUrlSchema,
  CORS_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ServerEnvInput = z.input<typeof serverEnvSchema>;

/** Browser-visible configuration. Vite inlines these into the client bundle. */
export const clientEnvSchema = z.object({
  VITE_API_BASE_URL: z.url().default('http://localhost:3000'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ClientEnvInput = z.input<typeof clientEnvSchema>;

/**
 * Parses a comma-separated origin list into a normalised array.
 * An empty value means "no cross-origin browser requests are allowed".
 */
export function parseCorsOrigins(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    })
    .join('\n');
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ConfigurationError(`Invalid ${label} configuration:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

/** Validates server-side environment variables, applying documented defaults. */
export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return parseOrThrow(serverEnvSchema, input, 'server');
}
