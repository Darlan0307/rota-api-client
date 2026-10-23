import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { appDataDir } from '../paths';
import { readJsonIfExists, writeJsonAtomic } from '../util/fs';
import { MCP_ACTION_CATEGORIES, type McpActionCategory } from './approval';

/**
 * Ponte local entre o servidor MCP e o app aberto: named pipe (Windows) ou
 * socket Unix, mensagens JSON por linha e um token gerado a cada abertura do
 * app (gravado em %APPDATA%/Rota/bridge.json, legível só pelo usuário).
 *
 * Usada para pedir confirmação de ações destrutivas no app e avisar o app
 * de mudanças feitas pelo Claude.
 */

export interface ConfirmRequest {
  /** Ex.: "Excluir a requisição", "Enviar DELETE". */
  title: string;
  /** Texto principal: o que será feito. */
  description: string;
  /** Linhas de detalhe (itens afetados, URL, configuração do teste...). */
  details: string[];
  /** Para destacar ações irreversíveis. */
  danger: boolean;
  /** Decide se o app pode liberar sem perguntar (veja `autoApproves`). */
  category: McpActionCategory;
}

export interface ConfirmResponse {
  approved: boolean;
  /** Motivo quando não aprovado (negado, tempo esgotado...). */
  reason?: string;
}

export type BridgeNotice =
  | { kind: 'changed'; message?: string | undefined }
  | { kind: 'state' }
  | { kind: 'history' }
  | { kind: 'trash' };

const BridgeInfoSchema = z.object({ pipe: z.string(), token: z.string(), pid: z.number() });
type BridgeInfo = z.infer<typeof BridgeInfoSchema>;

const RequestSchema = z.discriminatedUnion('method', [
  z.object({ id: z.number(), token: z.string(), method: z.literal('ping') }),
  z.object({
    id: z.number(),
    token: z.string(),
    method: z.literal('confirm'),
    params: z.object({
      title: z.string(),
      description: z.string(),
      details: z.array(z.string()),
      danger: z.boolean(),
      // Sem categoria válida, trata como crítica: sempre pergunta.
      category: z.enum(MCP_ACTION_CATEGORIES).catch('critical'),
    }),
  }),
  z.object({
    id: z.number(),
    token: z.string(),
    method: z.literal('notify'),
    params: z.object({
      kind: z.enum(['changed', 'state', 'history', 'trash']),
      message: z.string().optional(),
    }),
  }),
]);

export function bridgeInfoPath(dataDir = appDataDir()): string {
  return join(dataDir, 'bridge.json');
}

/** Nome do pipe: único por usuário e pasta de dados (testes não colidem com o app real). */
export function bridgePipeName(dataDir = appDataDir()): string {
  const hash = createHash('sha256')
    .update(`${userInfo().username}|${dataDir.toLowerCase()}`)
    .digest('hex')
    .slice(0, 12);
  return process.platform === 'win32' ? `\\\\.\\pipe\\rota-${hash}` : join(tmpdir(), `rota-${hash}.sock`);
}

export interface BridgeHandlers {
  confirm(request: ConfirmRequest): Promise<ConfirmResponse>;
  notify(notice: BridgeNotice): void;
}

export interface BridgeServer {
  close(): Promise<void>;
}

/** Inicia a ponte no app. Grava bridge.json com o token desta execução. */
export async function startBridgeServer(
  handlers: BridgeHandlers,
  dataDir = appDataDir(),
): Promise<BridgeServer> {
  const pipe = bridgePipeName(dataDir);
  const token = randomBytes(24).toString('hex');
  const expected = Buffer.from(token);
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1_000_000) socket.destroy();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        void handleLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });

  const reply = (socket: Socket, id: number, payload: object) => {
    if (!socket.destroyed) socket.write(`${JSON.stringify({ id, ...payload })}\n`);
  };

  async function handleLine(socket: Socket, line: string) {
    let parsed: z.infer<typeof RequestSchema>;
    try {
      parsed = RequestSchema.parse(JSON.parse(line));
    } catch {
      socket.destroy();
      return;
    }
    const given = Buffer.from(parsed.token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      reply(socket, parsed.id, { error: 'Token inválido.' });
      return;
    }
    try {
      if (parsed.method === 'ping') reply(socket, parsed.id, { result: { ok: true } });
      else if (parsed.method === 'notify') {
        handlers.notify(parsed.params as BridgeNotice);
        reply(socket, parsed.id, { result: { ok: true } });
      } else reply(socket, parsed.id, { result: await handlers.confirm(parsed.params) });
    } catch (error) {
      reply(socket, parsed.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // No Unix, um socket antigo (de uma execução que caiu) impede o listen.
  if (process.platform !== 'win32') rmSync(pipe, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => resolve());
  });
  await writeJsonAtomic(bridgeInfoPath(dataDir), { pipe, token, pid: process.pid } satisfies BridgeInfo);

  return {
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(bridgeInfoPath(dataDir), { force: true });
    },
  };
}

export class AppUnavailableError extends Error {
  constructor() {
    super(
      'O app Rota não está aberto. Esta ação precisa da sua confirmação no app: abra o Rota e tente de novo.',
    );
    this.name = 'AppUnavailableError';
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Cliente da ponte, usado pelo servidor MCP. */
export class BridgeClient {
  private nextId = 1;

  constructor(private readonly dataDir = appDataDir()) {}

  private async info(): Promise<BridgeInfo> {
    const raw = await readJsonIfExists(bridgeInfoPath(this.dataDir)).catch(() => undefined);
    const parsed = BridgeInfoSchema.safeParse(raw);
    if (!parsed.success || !processAlive(parsed.data.pid)) throw new AppUnavailableError();
    return parsed.data;
  }

  /** Indica se o app está aberto e respondendo. */
  async isAvailable(): Promise<boolean> {
    try {
      await this.call({ method: 'ping' }, 2000);
      return true;
    } catch {
      return false;
    }
  }

  /** Pede confirmação ao usuário no app (espera até `timeoutMs`). */
  async confirm(request: ConfirmRequest, timeoutMs = 120_000): Promise<ConfirmResponse> {
    return (await this.call({ method: 'confirm', params: request }, timeoutMs)) as ConfirmResponse;
  }

  /** Avisa o app (sem falhar se ele estiver fechado). */
  async notify(notice: BridgeNotice): Promise<void> {
    try {
      await this.call({ method: 'notify', params: notice }, 2000);
    } catch {
      // App fechado: nada a avisar.
    }
  }

  private async call(message: { method: string; params?: unknown }, timeoutMs: number): Promise<unknown> {
    const info = await this.info();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const socket = createConnection(info.pipe);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('O app não respondeu a tempo.'));
      }, timeoutMs);
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`${JSON.stringify({ id, token: info.token, ...message })}\n`));
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        clearTimeout(timer);
        socket.end();
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as { result?: unknown; error?: string };
          if (response.error) reject(new Error(response.error));
          else resolve(response.result);
        } catch (error) {
          reject(error);
        }
      });
      socket.on('error', () => {
        clearTimeout(timer);
        reject(new AppUnavailableError());
      });
    });
  }
}
