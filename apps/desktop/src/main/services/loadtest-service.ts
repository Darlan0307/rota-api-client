import {
  effectiveAuth,
  type LoadTestResult,
  type LoadTestStats,
  prepareRequest,
  runLoadTest,
  variableScopeFor,
} from '@rota/core';
import type { LoadTestInput } from '../../shared/ipc';
import type { SettingsService } from './settings-service';
import type { WorkspaceService } from './workspace-service';

/** Executa testes de carga (um por vez por runId) e permite cancelar. */
export class LoadTestService {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly settings: SettingsService,
    private readonly userAgent: string,
  ) {}

  async run(input: LoadTestInput, onProgress: (stats: LoadTestStats) => void): Promise<LoadTestResult> {
    const store = this.workspace.current;
    const ctx = {
      requestId: input.requestId,
      parentId: input.parentId,
      environmentId: this.workspace.activeEnvironmentId,
    };
    const settings = this.settings.get();
    // Mesma resolução do envio normal (variáveis, auth herdada), sem scripts.
    const prepared = prepareRequest(input.data, {
      scope: variableScopeFor(store, ctx),
      auth: effectiveAuth(store, input.data, ctx).auth,
      defaultTimeoutMs: settings.defaultTimeoutMs,
      userAgent: this.userAgent,
    });

    const controller = new AbortController();
    this.running.set(input.runId, controller);
    try {
      return await runLoadTest(prepared, input.config, {
        signal: controller.signal,
        proxy: settings.proxy,
        onProgress,
        progressIntervalMs: 500,
      });
    } finally {
      this.running.delete(input.runId);
    }
  }

  cancel(runId: string): void {
    this.running.get(runId)?.abort();
  }

  get isRunning(): boolean {
    return this.running.size > 0;
  }
}
