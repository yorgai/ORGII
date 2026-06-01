export interface LoadTurnBodyIntoStoreArgs {
  sessionId: string;
  turnId: string;
}

export interface SessionTurnLoader {
  loadTurnBodyIntoStore(args: LoadTurnBodyIntoStoreArgs): Promise<void>;
}
