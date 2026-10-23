import { jsonSyntaxError, withPlaceholders } from '../http/json-template';

/**
 * "Dados de teste" no corpo JSON: sugere uma variável dinâmica ({{$cpf}},
 * {{$email}}...) para cada campo pelo nome, e aplica só as escolhidas no
 * texto original (a formatação e o resto do corpo ficam como estão).
 */

export interface FillSuggestion {
  /** Caminho do campo, ex.: "cliente.email" ou "itens[0].preco". */
  path: string;
  key: string;
  /** Trecho do valor no texto original. */
  start: number;
  end: number;
  /** Valor atual como está no texto. */
  current: string;
  /** Nome da variável dinâmica, com o "$". */
  variable: string;
  /** Vai entre aspas (texto) ou cru (número). */
  quoted: boolean;
}

/** "Data_Nascimento", "data-nascimento", "dataNascimento" → "datanascimento". */
export function normalizeKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

type ValueKind = 'string' | 'number' | 'null';

interface Rule {
  test: (key: string) => boolean;
  pick: (current: string, kind: ValueKind) => string;
  /** Pode ir sem aspas quando o valor atual é número. */
  numeric?: boolean;
  /**
   * Nomes ambíguos ("nome" de um produto, "estado" como situação) só valem
   * dentro de um objeto que pareça pessoa ou endereço.
   */
  context?: 'person' | 'address';
}

/** Onde o campo está: chave do objeto pai e as outras chaves do mesmo objeto (normalizadas). */
export interface FieldContext {
  parent?: string;
  siblings?: readonly string[];
}

const PERSON_PARENT =
  /cliente|usuario|pessoa|contato|responsavel|comprador|destinatario|titular|paciente|aluno|funcionario|motorista|customer|user|buyer|owner|payer|pagador|socio|tomador|consumidor/;
const PERSON_SIBLING = /cpf|email|celular|telefone|fone|phone|nascimento|^rg$/;
const ADDRESS_PARENT = /endereco|address|entrega|cobranca|localizacao|location/;
const ADDRESS_SIBLING = /^(cep|logradouro|bairro|cidade|municipio|zipcode|street|city)$/;

function fits(context: Rule['context'], field: FieldContext): boolean {
  if (!context) return true;
  const parent = normalizeKey(field.parent ?? '');
  const siblings = field.siblings ?? [];
  if (context === 'person') return PERSON_PARENT.test(parent) || siblings.some((k) => PERSON_SIBLING.test(k));
  return ADDRESS_PARENT.test(parent) || siblings.some((k) => ADDRESS_SIBLING.test(k));
}

const hasFormatting = (current: string) => /[.\-/() ]/.test(current);
const oneOf =
  (...names: string[]) =>
  (key: string) =>
    names.includes(key);

/** A ordem importa: a primeira regra que casar vence. */
const RULES: Rule[] = [
  {
    test: (k) => k.includes('cnpj'),
    pick: (c) => (hasFormatting(c) ? '$cnpjFormatado' : '$cnpj'),
  },
  {
    test: (k) => k.includes('cpf') || k === 'documento' || k === 'nrdocumento',
    pick: (c) => (hasFormatting(c) ? '$cpfFormatado' : '$cpf'),
  },
  { test: (k) => k.includes('email') || k === 'mail', pick: () => '$email' },
  {
    test: (k) => /celular|telefone|fone|phone|whatsapp|mobile/.test(k),
    pick: (c) => (hasFormatting(c) ? '$celular' : '$celularNumeros'),
  },
  {
    test: (k) => /nascimento|birth|^dtnasc|^datanasc/.test(k),
    pick: () => '$dataNascimento',
  },
  { test: oneOf('cep', 'zipcode', 'zip', 'postalcode', 'codigopostal'), pick: () => '$cep' },
  {
    test: (k) =>
      /^(logradouro|endereco|rua|street|address|addressline1?)$/.test(k) || k === 'enderecologradouro',
    pick: () => '$logradouro',
  },
  { test: oneOf('bairro', 'neighborhood', 'district'), pick: () => '$bairro' },
  { test: oneOf('cidade', 'municipio', 'city', 'nomecidade', 'nomemunicipio'), pick: () => '$cidade' },
  { test: oneOf('uf', 'siglauf', 'siglaestado'), pick: () => '$uf' },
  { test: oneOf('estado', 'state'), pick: () => '$uf', context: 'address' },
  {
    test: (k) => /^(razaosocial|nomefantasia|empresa|company|companyname|nomeempresa|fantasia)$/.test(k),
    pick: () => '$empresa',
  },
  { test: oneOf('primeironome', 'firstname', 'givenname'), pick: () => '$nome' },
  { test: oneOf('sobrenome', 'lastname', 'surname', 'familyname'), pick: () => '$sobrenome' },
  {
    test: (k) =>
      /^(nomecompleto|fullname|nomecliente|nomeresponsavel|nomecontato|nomepessoa|nomeusuario|contato|responsavel)$/.test(
        k,
      ),
    pick: () => '$nomeCompleto',
  },
  { test: oneOf('nome', 'name'), pick: () => '$nomeCompleto', context: 'person' },
  { test: (k) => k === 'placa' || k.startsWith('placa'), pick: () => '$placa' },
  { test: (k) => /^(uuid|guid)$/.test(k) || k.endsWith('uuid'), pick: () => '$randomUUID' },
  {
    test: (k) => /^(preco|valor|price|amount|valorunitario|valortotal|precounitario|total|subtotal)$/.test(k),
    pick: () => '$preco',
    numeric: true,
  },
];

/** Variável sugerida para um campo, ou undefined se o nome não diz nada. */
export function suggestVariableFor(
  key: string,
  current = '',
  kind: ValueKind = 'string',
  context: FieldContext = {},
): string | undefined {
  return ruleFor(key, context)?.pick(current, kind);
}

function ruleFor(key: string, context: FieldContext): Rule | undefined {
  const k = normalizeKey(key);
  return RULES.find((r) => r.test(k) && fits(r.context, context));
}

interface Leaf {
  path: string;
  key: string;
  start: number;
  end: number;
  kind: ValueKind | 'boolean' | 'variable';
  /** Chave do objeto onde o campo está (para listas, a chave da lista). */
  parent: string;
  /** Objeto onde o campo está (para achar as chaves irmãs). */
  object: number;
}

/** Valores simples do JSON com a posição no texto. O texto já foi validado. */
function leaves(original: string): { leaves: Leaf[]; siblings: (object: number) => string[] } {
  const text = withPlaceholders(original);
  const out: Leaf[] = [];
  const objects: string[][] = [[]];
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  };
  const readString = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: string, key: string, parent: string, object: number): void => {
    ws();
    const ch = text[i];
    const start = i;
    const leaf = (kind: Leaf['kind']) => out.push({ path, key, start, end: i, kind, parent, object });
    if (ch === '{') {
      const id = objects.push([]) - 1;
      i++;
      ws();
      while (text[i] !== '}') {
        ws();
        const name = readString();
        objects[id]?.push(normalizeKey(name));
        ws();
        i++; // ":"
        value(path ? `${path}.${name}` : name, name, key, id);
        ws();
        if (text[i] === ',') i++;
        ws();
      }
      i++;
      return;
    }
    if (ch === '[') {
      i++;
      ws();
      let n = 0;
      while (text[i] !== ']') {
        value(`${path}[${n++}]`, key, parent, object);
        ws();
        if (text[i] === ',') i++;
        ws();
      }
      i++;
      return;
    }
    if (ch === '"') {
      readString();
      leaf('string');
      return;
    }
    const word = /^[^\s,}\]]+/.exec(text.slice(i))?.[0] ?? '';
    i += word.length;
    // {{VAR}} sem aspas virou "0   " no texto mascarado: o original começa com "{{".
    const kind = original.startsWith('{{', start)
      ? 'variable'
      : word === 'null'
        ? 'null'
        : word === 'true' || word === 'false'
          ? 'boolean'
          : 'number';
    leaf(kind);
  };
  value('', '', '', 0);
  return { leaves: out, siblings: (object: number) => objects[object] ?? [] };
}

/** Sugestões para o corpo JSON; null se o texto não for um JSON válido. */
export function suggestTestData(text: string): FillSuggestion[] | null {
  if (!text.trim() || jsonSyntaxError(text)) return null;
  const suggestions: FillSuggestion[] = [];
  const scan = leaves(text);
  for (const leaf of scan.leaves) {
    if (!leaf.key || leaf.kind === 'boolean' || leaf.kind === 'variable') continue;
    const raw = text.slice(leaf.start, leaf.end);
    if (raw.includes('{{')) continue;
    const current = leaf.kind === 'string' ? (JSON.parse(raw) as string) : raw;
    const rule = ruleFor(leaf.key, { parent: leaf.parent, siblings: scan.siblings(leaf.object) });
    if (!rule) continue;
    suggestions.push({
      path: leaf.path,
      key: leaf.key,
      start: leaf.start,
      end: leaf.end,
      current: raw,
      variable: rule.pick(current, leaf.kind),
      quoted: !(rule.numeric && leaf.kind === 'number'),
    });
  }
  return suggestions;
}

/** Troca os valores escolhidos pelas variáveis, de trás para frente (as posições continuam valendo). */
export function applyTestData(
  text: string,
  chosen: readonly Pick<FillSuggestion, 'start' | 'end' | 'variable' | 'quoted'>[],
): string {
  let out = text;
  for (const s of [...chosen].sort((a, b) => b.start - a.start)) {
    const ref = `{{${s.variable}}}`;
    out = out.slice(0, s.start) + (s.quoted ? `"${ref}"` : ref) + out.slice(s.end);
  }
  return out;
}
