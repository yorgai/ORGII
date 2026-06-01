import type { DatabaseType } from "@src/engines/DatabaseCore";

export interface DatabaseProviderOption {
  type: DatabaseType;
  labelKey: string;
  descriptionKey: string;
}

export const DATABASE_PROVIDERS: DatabaseProviderOption[] = [
  {
    type: "sqlite",
    labelKey: "databases.providers.sqlite",
    descriptionKey: "databases.providers.sqliteDesc",
  },
  {
    type: "postgres",
    labelKey: "databases.providers.postgres",
    descriptionKey: "databases.providers.postgresDesc",
  },
  {
    type: "mysql",
    labelKey: "databases.providers.mysql",
    descriptionKey: "databases.providers.mysqlDesc",
  },
  {
    type: "supabase",
    labelKey: "databases.providers.supabase",
    descriptionKey: "databases.providers.supabaseDesc",
  },
  {
    type: "neon",
    labelKey: "databases.providers.neon",
    descriptionKey: "databases.providers.neonDesc",
  },
  {
    type: "turso",
    labelKey: "databases.providers.turso",
    descriptionKey: "databases.providers.tursoDesc",
  },
];

export const DATABASE_STATUS_TEXT_COLOR: Record<string, string> = {
  connected: "text-success-6",
  connecting: "text-warning-6",
  error: "text-danger-6",
  disabled: "text-text-3",
  unknown: "text-text-3",
};

export const DATABASE_STATUS_DOT_COLOR: Record<string, string> = {
  connected: "bg-success-6",
  connecting: "bg-warning-6",
  error: "bg-danger-6",
  disabled: "bg-fill-3",
  unknown: "bg-fill-3",
};

/**
 * i18n key for a database provider's display label (e.g. "PostgreSQL",
 * "MySQL"). Use these instead of `type.charAt(0).toUpperCase()` so casing
 * matches the canonical brand spelling.
 */
export const DATABASE_PROVIDER_LABEL_KEY: Record<DatabaseType, string> = {
  sqlite: "databases.providers.sqlite",
  postgres: "databases.providers.postgres",
  mysql: "databases.providers.mysql",
  supabase: "databases.providers.supabase",
  neon: "databases.providers.neon",
  turso: "databases.providers.turso",
};
