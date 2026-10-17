import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  cloudflaredDownloadUrl,
  DEFAULT_CAPTURE_BODY,
  describeCloudflaredFailure,
  joinUrl,
  Mutex,
  newId,
  normalizeTarget,
  QuickTunnel,
  readJsonIfExists,
  summarizeExchange,
  type TunnelConfig,
  type TunnelExchange,
  type TunnelExchangeSummary,
  TunnelInspector,
  type TunnelStatus,
  type TunnelView,
  writeJsonAtomic,
} from '@rota/core';
import type { CloudflaredInfo } from '../../shared/ipc';

interface Runtime {
  inspector: TunnelInspector;
  tunnel: QuickTunnel | null;
  status: TunnelStatus;
  publicUrl: string | null;
  error: string | null;
  logs: string[];
}

const MAX_LOGS = 80;

/** Arquivo salvo: id, nome e destino obrigatórios; o resto ganha o padrão. */
function isConfig(
  value: unknown,
): value is Partial<TunnelConfig> & Pick<TunnelConfig, 'id' | 'name' | 'target'> {
  const v = value as Partial<TunnelConfig> | null;
  return Boolean(v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.target === 'string');
}

/**
 * Túneis públicos (cloudflared) com inspeção das chamadas. As configurações
 * ficam em %APPDATA%/Rota/tunnels.json (são desta máquina, não do projeto);
 * as chamadas recebidas ficam só na memória.
 */
export class TunnelService {
  private configs: TunnelConfig[] = [];
  private readonly runtimes = new Map<string, Runtime>();
  private notifyTimer: NodeJS.Timeout | undefined;
  /** Gravações do tunnels.json em fila (campos alterados em sequência). */
  private readonly writes = new Mutex();
  /** Download em andamento (dois cliques não baixam duas vezes no mesmo arquivo). */
  private installing: Promise<CloudflaredInfo> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly onChange: (views: TunnelView[]) => void,
  ) {}

  private get file() {
    return join(this.dataDir, 'tunnels.json');
  }

  /** PIDs dos cloudflared em execução (para encerrar sobras se o app for morto à força). */
  private get pidsFile() {
    return join(this.dataDir, 'tunnels.pids.json');
  }

  private savePids(): Promise<void> {
    const pids = [...this.runtimes.values()].map((rt) => rt.tunnel?.pid).filter((p): p is number => !!p);
    return this.writes
      .run(async () => {
        await mkdir(this.dataDir, { recursive: true });
        await writeJsonAtomic(this.pidsFile, pids);
      })
      .catch(() => undefined);
  }

  /**
   * O Rota foi fechado à força (Gerenciador de Tarefas, queda): encerra os
   * cloudflared que ficaram rodando. Só mata o PID se ele ainda for um cloudflared.
   */
  private async killOrphans(): Promise<void> {
    const saved = await readJsonIfExists(this.pidsFile).catch(() => null);
    if (!Array.isArray(saved) || saved.length === 0) return;
    for (const pid of saved) {
      if (typeof pid !== 'number') continue;
      try {
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          windowsHide: true,
        });
        if (/"cloudflared(\.exe)?"/i.test(out)) process.kill(pid);
      } catch {
        // Já encerrado.
      }
    }
    await writeJsonAtomic(this.pidsFile, []).catch(() => undefined);
  }

  private get appBinary() {
    return join(this.dataDir, 'bin', 'cloudflared.exe');
  }

  async load(): Promise<void> {
    await this.killOrphans();
    const saved = await readJsonIfExists(this.file).catch(() => null);
    const list = Array.isArray(saved) ? saved : [];
    this.configs = list.filter(isConfig).map((c) => ({
      mode: 'forward',
      preserveHost: false,
      captureStatus: 200,
      captureBody: DEFAULT_CAPTURE_BODY,
      webhookPath: '',
      ...c,
      // Arquivo editado à mão: destino inválido volta ao padrão.
      target: normalizeTarget(c.target) ?? 'http://localhost:3000',
    }));
  }

  private persist(): Promise<void> {
    return this.writes.run(async () => {
      await mkdir(this.dataDir, { recursive: true });
      await writeJsonAtomic(this.file, this.configs);
    });
  }

  private runtime(id: string): Runtime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      const runtime: Runtime = {
        inspector: new TunnelInspector({
          getConfig: () => this.config(id),
          onExchange: () => this.notify(true),
        }),
        tunnel: null,
        status: 'stopped',
        publicUrl: null,
        error: null,
        logs: [],
      };
      this.runtimes.set(id, runtime);
      rt = runtime;
    }
    return rt;
  }

  private config(id: string): TunnelConfig {
    const config = this.configs.find((c) => c.id === id);
    if (!config) throw new Error('Túnel não encontrado.');
    return config;
  }

  views(): TunnelView[] {
    return this.configs.map((config) => {
      const rt = this.runtimes.get(config.id);
      return {
        config,
        status: rt?.status ?? 'stopped',
        publicUrl: rt?.publicUrl ?? null,
        error: rt?.error ?? null,
        logs: rt?.logs ?? [],
        exchanges: rt?.inspector.list().map(summarizeExchange) ?? [],
      };
    });
  }

  /** Chamadas chegando em rajada: agrupa os avisos ao renderer. */
  private notify(batch = false): void {
    if (!batch) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = undefined;
      this.onChange(this.views());
      return;
    }
    this.notifyTimer ??= setTimeout(() => {
      this.notifyTimer = undefined;
      this.onChange(this.views());
    }, 150);
  }

  // -------------------------------------------------------------------------
  // cloudflared

  binary(): CloudflaredInfo {
    if (existsSync(this.appBinary)) return { installed: true, path: this.appBinary, source: 'app' };
    const found = spawnSync('where.exe', ['cloudflared'], { encoding: 'utf8', windowsHide: true });
    const path = found.status === 0 ? found.stdout.split(/\r?\n/)[0]?.trim() : '';
    return path ? { installed: true, path, source: 'path' } : { installed: false, path: null, source: null };
  }

  /** Baixa o cloudflared oficial (GitHub da Cloudflare) para %APPDATA%/Rota/bin. */
  install(onProgress: (received: number, total: number | null) => void): Promise<CloudflaredInfo> {
    this.installing ??= this.download(onProgress).finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  private async download(
    onProgress: (received: number, total: number | null) => void,
  ): Promise<CloudflaredInfo> {
    const target = this.appBinary;
    const partial = `${target}.part`;
    await mkdir(join(this.dataDir, 'bin'), { recursive: true });
    let response: Response;
    try {
      response = await fetch(cloudflaredDownloadUrl());
    } catch {
      throw new Error(
        'Não foi possível baixar o cloudflared. Verifique a conexão com a internet (ou um proxy/firewall bloqueando o GitHub).',
      );
    }
    if (!response.ok || !response.body)
      throw new Error(`Não foi possível baixar o cloudflared (HTTP ${response.status}).`);
    const total = Number(response.headers.get('content-length')) || null;
    let received = 0;
    let lastReport = 0;
    const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (Date.now() - lastReport > 150) {
        lastReport = Date.now();
        onProgress(received, total);
      }
    });
    try {
      await pipeline(source, createWriteStream(partial));
      // Executável do Windows começa com "MZ"; evita salvar uma página de erro.
      const handle = await open(partial, 'r');
      const header = Buffer.alloc(2);
      await handle.read(header, 0, 2, 0);
      await handle.close();
      if (header.toString('latin1') !== 'MZ' || received < 1024 * 1024)
        throw new Error('O arquivo baixado não é o cloudflared esperado.');
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      if (error instanceof Error && error.message.startsWith('O arquivo baixado')) throw error;
      throw new Error('O download do cloudflared foi interrompido. Tente de novo.');
    }
    onProgress(received, total);
    return this.binary();
  }

  // -------------------------------------------------------------------------
  // Configurações

  async create(patch: Partial<TunnelConfig> = {}): Promise<string> {
    const target = normalizeTarget(patch.target ?? '3000');
    if (!target)
      throw new Error('Destino inválido. Use uma porta (3000) ou um endereço (http://localhost:8080).');
    const config: TunnelConfig = {
      id: newId(),
      name: patch.name?.trim() || `API ${new URL(target).host}`,
      target,
      mode: patch.mode ?? 'forward',
      preserveHost: patch.preserveHost ?? false,
      captureStatus: patch.captureStatus ?? 200,
      captureBody: patch.captureBody ?? DEFAULT_CAPTURE_BODY,
      webhookPath: patch.webhookPath ?? '',
    };
    this.configs.push(config);
    await this.persist();
    this.notify();
    return config.id;
  }

  /** Vale na hora, inclusive com o túnel ligado (a URL pública não muda). */
  async update(id: string, patch: Partial<Omit<TunnelConfig, 'id'>>): Promise<void> {
    const current = this.config(id);
    const next = { ...current, ...patch };
    if (patch.target !== undefined) {
      const target = normalizeTarget(patch.target);
      if (!target)
        throw new Error('Destino inválido. Use uma porta (3000) ou um endereço (http://localhost:8080).');
      next.target = target;
    }
    if (patch.name !== undefined) next.name = patch.name.trim() || current.name;
    if (patch.captureStatus !== undefined && !(patch.captureStatus >= 100 && patch.captureStatus <= 599))
      throw new Error('Status HTTP inválido (100 a 599).');
    this.configs = this.configs.map((c) => (c.id === id ? next : c));
    await this.persist();
    this.notify();
  }

  async remove(id: string): Promise<void> {
    await this.stop(id);
    this.runtimes.delete(id);
    this.configs = this.configs.filter((c) => c.id !== id);
    await this.persist();
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Ligar e desligar

  /** true = ligado; false = cancelado no meio (Desligar durante o "Ligando…"). */
  async start(id: string): Promise<boolean> {
    this.config(id);
    const rt = this.runtime(id);
    if (rt.status === 'running') return true;
    if (rt.status === 'starting') return false;
    const binary = this.binary();
    if (!binary.path) throw new Error('Baixe o cloudflared antes de ligar o túnel.');

    rt.status = 'starting';
    rt.error = null;
    rt.logs = [];
    this.notify();
    try {
      const port = await rt.inspector.start();
      const tunnel = new QuickTunnel();
      rt.tunnel = tunnel;
      const starting = tunnel.start({
        binary: binary.path,
        localPort: port,
        onLog: (line) => {
          rt.logs = [...rt.logs, line].slice(-MAX_LOGS);
        },
        onExit: (_code, logs) => {
          // Caiu sozinho (rede, Cloudflare): avisa e libera a porta local.
          rt.tunnel = null;
          rt.status = 'error';
          rt.publicUrl = null;
          rt.error = `O túnel caiu. ${describeCloudflaredFailure(logs)}`;
          void rt.inspector.stop();
          void this.savePids();
          this.notify();
        },
      });
      void this.savePids();
      rt.publicUrl = await starting;
      // Cancelado enquanto ligava.
      if (rt.status !== 'starting') return false;
      rt.status = 'running';
    } catch (error) {
      // Cancelado pelo usuário (Desligar/Excluir durante o "Ligando…"): stop() já limpou tudo.
      if (rt.status !== 'starting') return false;
      rt.tunnel?.stop();
      rt.tunnel = null;
      void this.savePids();
      await rt.inspector.stop();
      rt.status = 'error';
      rt.publicUrl = null;
      rt.error = error instanceof Error ? error.message : String(error);
      this.notify();
      throw error;
    }
    this.notify();
    return true;
  }

  async stop(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.tunnel?.stop();
    rt.tunnel = null;
    void this.savePids();
    await rt.inspector.stop();
    rt.status = 'stopped';
    rt.publicUrl = null;
    rt.error = null;
    this.notify();
  }

  /** Fechamento do app: encerra os cloudflared e libera as portas locais. */
  async stopAll(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const rt of this.runtimes.values()) {
      rt.tunnel?.stop();
      rt.tunnel = null;
      stops.push(rt.inspector.stop());
    }
    stops.push(this.savePids());
    await Promise.allSettled(stops);
  }

  // -------------------------------------------------------------------------
  // Chamadas recebidas

  exchange(id: string, exchangeId: string): TunnelExchange | null {
    return this.runtimes.get(id)?.inspector.get(exchangeId) ?? null;
  }

  async replay(id: string, exchangeId: string): Promise<TunnelExchangeSummary> {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error('Chamada não encontrada.');
    return summarizeExchange(await rt.inspector.replay(exchangeId));
  }

  /**
   * Teste de ponta a ponta: chama a URL pública pela internet (Cloudflare →
   * cloudflared → Rota → API). A chamada aparece na lista como qualquer outra.
   */
  async test(id: string, path?: string): Promise<{ status: number; url: string }> {
    const config = this.config(id);
    const publicUrl = this.runtimes.get(id)?.publicUrl;
    if (!publicUrl) throw new Error('Ligue o túnel antes de testar.');
    // O caminho vem da tela (pode ainda não ter sido salvo).
    const url = joinUrl(publicUrl, path ?? config.webhookPath);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Rota (teste do túnel)' },
        body: JSON.stringify({ teste: 'Rota', enviadoEm: new Date().toISOString() }),
        signal: AbortSignal.timeout(20_000),
      });
      await response.arrayBuffer();
      return { status: response.status, url };
    } catch {
      throw new Error(
        'A URL pública não respondeu. Um túnel recém-ligado pode levar alguns segundos para funcionar: tente de novo.',
      );
    }
  }

  clear(id: string): void {
    this.runtimes.get(id)?.inspector.clear();
    this.notify();
  }
}
