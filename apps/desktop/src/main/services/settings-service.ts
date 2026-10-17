import { type AppSettings, AppSettingsSchema, loadAppSettings, saveAppSettings } from '@rota/core';

/** Configurações globais do app, mantidas em memória e gravadas a cada alteração. */
export class SettingsService {
  private settings: AppSettings = AppSettingsSchema.parse({});

  async load(): Promise<AppSettings> {
    this.settings = await loadAppSettings();
    return this.settings;
  }

  get(): AppSettings {
    return this.settings;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = AppSettingsSchema.parse({ ...this.settings, ...patch });
    await saveAppSettings(this.settings);
    return this.settings;
  }
}
