import { type RunResult, runRequest } from '@rota/core';
import type { SendRequestInput } from '../../shared/ipc';
import type { SettingsService } from './settings-service';
import type { WorkspaceService } from './workspace-service';

/** Envia requisições no processo principal (sem CORS) e permite cancelar. */
export class RequestService {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly settings: SettingsService,
    private readonly userAgent: string,
  ) {}

  async send(input: SendRequestInput): Promise<RunResult> {
    const controller = new AbortController();
    this.running.set(input.runId, controller);
    try {
      const settings = this.settings.get();
      const { result } = await runRequest(input.data, {
        store: this.workspace.current,
        requestId: input.requestId,
        parentId: input.parentId,
        environmentId: this.workspace.activeEnvironmentId,
        settings: {
          defaultTimeoutMs: settings.defaultTimeoutMs,
          proxy: settings.proxy,
          userAgent: this.userAgent,
        },
        signal: controller.signal,
      });
      return result;
    } finally {
      this.running.delete(input.runId);
    }
  }

  cancel(runId: string): void {
    this.running.get(runId)?.abort();
  }
}
