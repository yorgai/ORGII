/**
 * Database Service Factory
 *
 * Creates database service instances based on connection configuration.
 * Decoupled from any store — callers provide configs directly, and
 * can optionally pass a config loader for reconnection.
 */
import type { DatabaseConnectionConfig, IDatabaseService } from "./types";

const MAX_SERVICE_CACHE = 50;
const serviceCache = new Map<string, IDatabaseService>();

async function createSqliteProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { TauriSqliteProvider } =
    await import("./providers/TauriSqliteProvider");
  return new TauriSqliteProvider(
    config as ConstructorParameters<typeof TauriSqliteProvider>[0]
  );
}

async function createSupabaseProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { SupabaseProvider } = await import("./providers/SupabaseProvider");
  return new SupabaseProvider(
    config as ConstructorParameters<typeof SupabaseProvider>[0]
  );
}

async function createTursoProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { TursoProvider } = await import("./providers/TursoProvider");
  return new TursoProvider(
    config as ConstructorParameters<typeof TursoProvider>[0]
  );
}

async function createNeonProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { NeonProvider } = await import("./providers/NeonProvider");
  return new NeonProvider(
    config as ConstructorParameters<typeof NeonProvider>[0]
  );
}

async function createPostgresProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { PostgresProvider } = await import("./providers/PostgresProvider");
  return new PostgresProvider(
    config as ConstructorParameters<typeof PostgresProvider>[0]
  );
}

async function createMySQLProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { MySQLProvider } = await import("./providers/MySQLProvider");
  return new MySQLProvider(
    config as ConstructorParameters<typeof MySQLProvider>[0]
  );
}

export type ConfigLoader = () => DatabaseConnectionConfig[];

export const DatabaseServiceFactory = {
  async create(
    config: DatabaseConnectionConfig,
    forceNew = false
  ): Promise<IDatabaseService> {
    if (!forceNew && serviceCache.has(config.id)) {
      return serviceCache.get(config.id)!;
    }

    let service: IDatabaseService;

    switch (config.type) {
      case "sqlite":
        service = await createSqliteProvider(config);
        break;
      case "supabase":
        service = await createSupabaseProvider(config);
        break;
      case "turso":
        service = await createTursoProvider(config);
        break;
      case "neon":
        service = await createNeonProvider(config);
        break;
      case "postgres":
        service = await createPostgresProvider(config);
        break;
      case "mysql":
        service = await createMySQLProvider(config);
        break;
      default:
        throw new Error(
          `Unsupported database type: ${(config as DatabaseConnectionConfig).type}`
        );
    }

    if (serviceCache.size >= MAX_SERVICE_CACHE) {
      const firstKey = serviceCache.keys().next().value;
      if (firstKey) {
        const evicted = serviceCache.get(firstKey);
        if (evicted?.isConnected()) {
          evicted.disconnect().catch(console.error);
        }
        serviceCache.delete(firstKey);
      }
    }

    serviceCache.set(config.id, service);
    return service;
  },

  get(connectionId: string): IDatabaseService | undefined {
    return serviceCache.get(connectionId);
  },

  /**
   * Get a service, auto-reconnecting via the provided config loader if
   * the instance is not cached (e.g. after hot-reload).
   */
  async getOrReconnect(
    connectionId: string,
    loadConfigs: ConfigLoader
  ): Promise<IDatabaseService | undefined> {
    const cached = serviceCache.get(connectionId);
    if (cached) {
      if (!cached.isConnected()) {
        await cached.connect();
      }
      return cached;
    }

    const configs = loadConfigs();
    const config = configs.find((cfg) => cfg.id === connectionId);
    if (!config) return undefined;

    const service = await this.create(config);
    await service.connect();
    return service;
  },

  has(connectionId: string): boolean {
    return serviceCache.has(connectionId);
  },

  remove(connectionId: string): boolean {
    const service = serviceCache.get(connectionId);
    if (service) {
      if (service.isConnected()) {
        service.disconnect().catch(console.error);
      }
      return serviceCache.delete(connectionId);
    }
    return false;
  },

  async clearAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];
    for (const service of serviceCache.values()) {
      if (service.isConnected()) {
        disconnectPromises.push(service.disconnect());
      }
    }
    await Promise.allSettled(disconnectPromises);
    serviceCache.clear();
  },

  getConnectionIds(): string[] {
    return Array.from(serviceCache.keys());
  },

  getAllServices(): IDatabaseService[] {
    return Array.from(serviceCache.values());
  },
};

export default DatabaseServiceFactory;
