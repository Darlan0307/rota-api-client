/**
 * Contrato tipado da comunicação renderer -> main.
 *
 * Cada canal declara os argumentos e o retorno. O preload só repassa canais
 * presentes em IPC_CHANNELS, e o main registra handlers via `handle()`, que
 * exige a mesma assinatura. Para adicionar um canal: declare aqui, inclua na
 * lista e registre o handler em src/main/ipc.
 */

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userDataPath: string;
}

export interface TitleBarColors {
  color: string;
  symbolColor: string;
}

export interface IpcContract {
  'app:getInfo': { args: []; result: AppInfo };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno; `void` aceita handlers sem `return`
  'window:setTitleBarColors': { args: [colors: TitleBarColors]; result: void };
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result'];

export const IPC_CHANNELS = [
  'app:getInfo',
  'window:setTitleBarColors',
] as const satisfies readonly IpcChannel[];

// Garante em tempo de compilação que a lista cobre todos os canais do contrato.
type MissingChannels = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>;
const _allChannelsListed: MissingChannels extends never ? true : MissingChannels = true;
void _allChannelsListed;

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value);
}

/** API exposta pelo preload em `window.api`. */
export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>;
}
