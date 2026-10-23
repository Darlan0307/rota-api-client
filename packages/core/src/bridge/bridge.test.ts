import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeJsonAtomic } from '../util/fs';
import {
  AppUnavailableError,
  BridgeClient,
  type BridgeNotice,
  bridgeInfoPath,
  type ConfirmRequest,
  startBridgeServer,
} from './bridge';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rota-bridge-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('ponte app <-> MCP', () => {
  it('pede confirmação e recebe avisos', async () => {
    const notices: BridgeNotice[] = [];
    const categories: string[] = [];
    const server = await startBridgeServer(
      {
        confirm: async (req) => {
          categories.push(req.category);
          return {
            approved: req.title === 'Pode',
            ...(req.title === 'Pode' ? {} : { reason: 'negado' }),
          };
        },
        notify: (n) => notices.push(n),
      },
      dir,
    );
    try {
      const client = new BridgeClient(dir);
      expect(await client.isAvailable()).toBe(true);
      expect(
        await client.confirm({
          title: 'Pode',
          description: '',
          details: [],
          danger: false,
          category: 'edit',
        }),
      ).toEqual({
        approved: true,
      });
      expect(
        await client.confirm({ title: 'Não', description: '', details: [], danger: true, category: 'edit' }),
      ).toEqual({
        approved: false,
        reason: 'negado',
      });
      // Sem categoria (servidor MCP antigo), o app recebe como crítica: sempre pergunta.
      const legacy = {
        title: 'Pode',
        description: '',
        details: [],
        danger: false,
      } as unknown as ConfirmRequest;
      await client.confirm(legacy);
      expect(categories.at(-1)).toBe('critical');
      await client.notify({ kind: 'changed', message: 'criou X' });
      expect(notices).toEqual([{ kind: 'changed', message: 'criou X' }]);
    } finally {
      await server.close();
    }
  });

  it('recusa token errado', async () => {
    const server = await startBridgeServer(
      { confirm: async () => ({ approved: true }), notify: () => undefined },
      dir,
    );
    try {
      const info = JSON.parse(await (await import('node:fs/promises')).readFile(bridgeInfoPath(dir), 'utf8'));
      await writeJsonAtomic(bridgeInfoPath(dir), { ...info, token: 'x'.repeat(48) });
      await expect(
        new BridgeClient(dir).confirm({
          title: 't',
          description: '',
          details: [],
          danger: false,
          category: 'edit',
        }),
      ).rejects.toThrow(/Token inválido/);
    } finally {
      await server.close();
    }
  });

  it('informa que o app está fechado', async () => {
    const client = new BridgeClient(dir);
    expect(await client.isAvailable()).toBe(false);
    await expect(
      client.confirm({ title: 't', description: '', details: [], danger: false, category: 'edit' }),
    ).rejects.toBeInstanceOf(AppUnavailableError);
    // bridge.json de uma execução que já terminou (processo inexistente).
    await writeJsonAtomic(bridgeInfoPath(dir), { pipe: 'x', token: 't', pid: 999_999_999 });
    await expect(
      client.confirm({ title: 't', description: '', details: [], danger: false, category: 'edit' }),
    ).rejects.toBeInstanceOf(AppUnavailableError);
    await client.notify({ kind: 'state' }); // não lança
  });
});
