import { type AppSettings, AppSettingsSchema, loadAppSettings, saveAppSettings } from '@rota/core';

/** Configurações globais do app, mantidas em memória e gravadas a cada alteração. */
export class SettingsService {
  private settings: AppSettings = AppSettingsSchema.parse({});
  private readonly listeners = new Set<(next: AppSettings, previous: AppSettings) => void>();

  /** Avisa a cada alteração gravada (ex.: aplicar o zoom na janela). */
  onChange(listener: (next: AppSettings, previous: AppSettings) => void): void {
    this.listeners.add(listener);
  }

  async load(): Promise<AppSettings> {
    this.settings = await loadAppSettings();
    return this.settings;
  }

  get(): AppSettings {
    return this.settings;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const previous = this.settings;
    this.settings = AppSettingsSchema.parse({ ...this.settings, ...patch });
    await saveAppSettings(this.settings);
    for (const listener of this.listeners) listener(this.settings, previous);
    return this.settings;
  }
}
