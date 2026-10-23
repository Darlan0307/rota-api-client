/**
 * Tipos a partir de dados: TypeScript, Zod e JSON Schema a partir da forma de
 * uma resposta JSON (a mesma usada na verificação de contrato), e TypeScript
 * a partir das colunas de uma tabela.
 */

import { inferShape, type Shape, type ShapeType } from '../contract/shape';
import type { DbTable } from '../database/types';

export const TYPE_TARGETS = ['typescript', 'zod', 'jsonschema'] as const;
export type TypeTarget = (typeof TYPE_TARGETS)[number];

export const TYPE_TARGET_LABELS: Record<TypeTarget, string> = {
  typescript: 'TypeScript',
  zod: 'Zod',
  jsonschema: 'JSON Schema',
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** "data_nascimento", "data-nascimento", "DATA NASCIMENTO" → "DataNascimento". */
export function pascalCase(text: string): string {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  if (!name) return 'Tipo';
  return /^\d/.test(name) ? `T${name}` : name;
}

/** Singular aproximado (português e inglês), só para nomear tipos: "itens" → "item", "pedidos" → "pedido". */
export function singular(word: string): string {
  if (word.length <= 3) return word;
  const rules: [RegExp, string][] = [
    [/ões$/i, 'ao'],
    [/ães$/i, 'ao'],
    [/ns$/i, 'm'],
    [/ies$/i, 'y'],
    [/(ss|us|is)$/i, '$1'],
    [/s$/i, ''],
  ];
  for (const [pattern, replacement] of rules)
    if (pattern.test(word)) return word.replace(pattern, replacement);
  return word;
}

function scalar(types: readonly ShapeType[]): ShapeType[] {
  return types.filter((t) => t !== 'null');
}

// ---------------------------------------------------------------------------
// TypeScript

class Names {
  private readonly used = new Set<string>();
  take(base: string): string {
    let name = base;
    for (let i = 2; this.used.has(name); i++) name = `${base}${i}`;
    this.used.add(name);
    return name;
  }
}

/**
 * Interfaces TypeScript, uma por objeto aninhado (mais fácil de ler e
 * reaproveitar que um tipo único gigante).
 */
export function shapeToTypeScript(shape: Shape, rootName: string): string {
  const names = new Names();
  const blocks: string[] = [];

  function typeOf(s: Shape, name: string): string {
    const parts = s.types.map((t): string => {
      switch (t) {
        case 'object':
          return s.fields && Object.keys(s.fields).length > 0 ? declare(s, name) : 'Record<string, unknown>';
        case 'array': {
          if (!s.items) return 'unknown[]';
          // Quem chama já passa o nome no singular (itens → Item).
          const item = typeOf(s.items, name);
          return /[|&]/.test(item) ? `(${item})[]` : `${item}[]`;
        }
        default:
          return t;
      }
    });
    return [...new Set(parts)].join(' | ');
  }

  function declare(s: Shape, base: string): string {
    const name = names.take(base);
    const lines = Object.entries(s.fields ?? {}).map(([key, field]) => {
      const childBase = `${name === rootName ? '' : name}${pascalCase(
        field.shape.types.includes('array') ? singular(key) : key,
      )}`;
      return `  ${propertyKey(key)}${field.optional ? '?' : ''}: ${typeOf(field.shape, childBase || pascalCase(key))};`;
    });
    // Os filhos são declarados antes do pai; a lista é invertida no fim para a raiz vir primeiro.
    blocks.push(`export interface ${name} {\n${lines.join('\n')}\n}`);
    return name;
  }

  const onlyObject = shape.types.length === 1 && shape.types[0] === 'object' && shape.fields;
  if (onlyObject) {
    declare(shape, rootName);
    return blocks.reverse().join('\n\n');
  }
  names.take(rootName);
  const itemName = singular(rootName) === rootName ? `${rootName}Item` : singular(rootName);
  const root = `export type ${rootName} = ${typeOf(shape, itemName)};`;
  return [root, ...blocks.reverse()].join('\n\n');
}

// ---------------------------------------------------------------------------
// Zod

export function shapeToZod(shape: Shape, rootName: string): string {
  function schema(s: Shape, indent: string): string {
    const nullable = s.types.includes('null');
    const kinds = scalar(s.types);
    const parts = kinds.map((t): string => {
      switch (t) {
        case 'string':
          return 'z.string()';
        case 'number':
          return 'z.number()';
        case 'boolean':
          return 'z.boolean()';
        case 'array':
          return `z.array(${s.items ? schema(s.items, indent) : 'z.unknown()'})`;
        default: {
          const entries = Object.entries(s.fields ?? {});
          if (entries.length === 0) return 'z.record(z.string(), z.unknown())';
          const inner = `${indent}  `;
          const lines = entries.map(
            ([key, field]) =>
              `${inner}${propertyKey(key)}: ${schema(field.shape, inner)}${field.optional ? '.optional()' : ''},`,
          );
          return `z.object({\n${lines.join('\n')}\n${indent}})`;
        }
      }
    });
    if (parts.length === 0) return 'z.null()';
    const base = parts.length === 1 ? (parts[0] as string) : `z.union([${parts.join(', ')}])`;
    return nullable ? `${base}.nullable()` : base;
  }
  return [
    "import { z } from 'zod';",
    '',
    `export const ${rootName}Schema = ${schema(shape, '')};`,
    '',
    `export type ${rootName} = z.infer<typeof ${rootName}Schema>;`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// JSON Schema

type JsonSchema = Record<string, unknown>;

function shapeSchema(s: Shape): JsonSchema {
  const types = s.types.map((t) => (t === 'number' ? 'number' : t));
  const out: JsonSchema = { type: types.length === 1 ? types[0] : types };
  if (s.fields && s.types.includes('object')) {
    const entries = Object.entries(s.fields);
    out.properties = Object.fromEntries(entries.map(([k, f]) => [k, shapeSchema(f.shape)]));
    const required = entries.filter(([, f]) => !f.optional).map(([k]) => k);
    if (required.length > 0) out.required = required;
  }
  if (s.items && s.types.includes('array')) out.items = shapeSchema(s.items);
  return out;
}

export function shapeToJsonSchema(shape: Shape, title: string): string {
  return JSON.stringify(
    { $schema: 'http://json-schema.org/draft-07/schema#', title, ...shapeSchema(shape) },
    null,
    2,
  );
}

export function generateTypes(value: unknown, target: TypeTarget, rootName: string): string {
  const name = pascalCase(rootName);
  const shape = inferShape(value);
  if (target === 'zod') return shapeToZod(shape, name);
  if (target === 'jsonschema') return shapeToJsonSchema(shape, name);
  return shapeToTypeScript(shape, name);
}

// ---------------------------------------------------------------------------
// Tabela → TypeScript

/** Tipo TypeScript natural para uma coluna (o driver do seu projeto pode entregar diferente). */
export function sqlTypeToTs(sqlType: string): string {
  const t = sqlType.toLowerCase();
  if (/sub_type (1|text)|^(var)?char|^n?(var)?char|text|^character|clob|^string|enum|^set\b|xml/.test(t))
    return 'string';
  if (/uuid|uniqueidentifier/.test(t)) return 'string';
  if (/^bool|^bit\b|tinyint\(1\)/.test(t)) return 'boolean';
  if (/int|serial|numeric|decimal|money|float|double|real|number/.test(t)) return 'number';
  if (/date|time|year|interval/.test(t)) return 'string';
  if (/json/.test(t)) return 'unknown';
  if (/blob|bytea|binary|image|raw/.test(t)) return 'Uint8Array';
  return 'unknown';
}

export function tableToTypeScript(table: DbTable): string {
  const base = table.name.includes('.') ? (table.name.split('.').pop() as string) : table.name;
  const name = pascalCase(singular(base));
  const lines = table.columns.map((c) => {
    const notes = [c.type, c.primaryKey ? 'PK' : '', c.references ? `→ ${c.references}` : '']
      .filter(Boolean)
      .join(' · ');
    return `  /** ${notes} */\n  ${propertyKey(c.name)}: ${sqlTypeToTs(c.type)}${c.nullable ? ' | null' : ''};`;
  });
  return `/** ${table.kind === 'view' ? 'View' : 'Tabela'} ${table.name} */\nexport interface ${name} {\n${lines.join('\n')}\n}`;
}
