import { describe, expect, it } from 'vitest';
import { RequestDataSchema } from '../model/schemas';
import { automaticHeaders } from './auto-headers';

const make = (data: unknown) => RequestDataSchema.parse(data);

describe('automaticHeaders', () => {
  it('lista os headers do corpo, da autenticação, os padrões e os da conexão', () => {
    const list = automaticHeaders(
      make({ method: 'POST', body: { mode: 'json', text: '{}' } }),
      { type: 'bearer', token: '{{TOKEN}}' },
      { userAgent: 'Rota/1.0.0' },
    );
    expect(list.map((h) => [h.key, h.value])).toEqual([
      ['Authorization', 'Bearer {{TOKEN}}'],
      ['Content-Type', 'application/json'],
      ['User-Agent', 'Rota/1.0.0'],
      ['Accept', '*/*'],
      ['Accept-Encoding', 'gzip, deflate, br'],
      ['Host', '<calculado no envio>'],
      ['Content-Length', '<calculado no envio>'],
      ['Connection', 'keep-alive'],
    ]);
    expect(list.find((h) => h.key === 'Authorization')?.toggle).toBeUndefined();
    expect(list.find((h) => h.key === 'Accept')?.toggle).toBe('accept');
  });

  it('marca os desligados e os substituídos por um header da tabela', () => {
    const list = automaticHeaders(
      make({
        headers: [{ key: 'accept', value: 'application/json' }],
        settings: { disabledAutoHeaders: ['user-agent'] },
      }),
      { type: 'none' },
    );
    expect(list.find((h) => h.key === 'Accept')).toMatchObject({ overridden: true, disabled: false });
    expect(list.find((h) => h.key === 'User-Agent')).toMatchObject({ disabled: true, value: 'Rota' });
    expect(list.some((h) => h.key === 'Content-Length')).toBe(false);
  });

  it('formulário multipart: Content-Type calculado e sem opção de desligar', () => {
    const [type] = automaticHeaders(make({ body: { mode: 'formdata', fields: [] } }), { type: 'none' });
    expect(type).toMatchObject({ key: 'Content-Type', calculated: true });
    expect(type?.toggle).toBeUndefined();
  });
});
