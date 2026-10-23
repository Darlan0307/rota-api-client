import { describe, expect, it } from 'vitest';
import { autoApproves, type McpAutoApprove } from './approval';

const none: McpAutoApprove = { organize: false, edit: false, delete: false, send: false };
const all: McpAutoApprove = { organize: true, edit: true, delete: true, send: true };

describe('autoApproves', () => {
  it('segue as configurações por categoria', () => {
    expect(autoApproves('organize', { ...none, organize: true }, new Set())).toBe(true);
    expect(autoApproves('edit', { ...none, organize: true }, new Set())).toBe(false);
  });

  it('aceita o que foi liberado até fechar o app', () => {
    expect(autoApproves('send', none, new Set(['send']))).toBe(true);
    expect(autoApproves('delete', none, new Set(['send']))).toBe(false);
  });

  it('nunca libera as ações críticas', () => {
    expect(autoApproves('critical', all, new Set())).toBe(false);
  });
});
