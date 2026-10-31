// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${1:nome} é a sintaxe dos snippets do Monaco, não interpolação.
import type { DbEngine } from './types';

/**
 * Colinha de SQL por motor. Cada exemplo é um snippet do Monaco: ${1:tabela}
 * vira um campo para preencher, e Tab passa para o próximo.
 */

export interface SqlExample {
  title: string;
  description: string;
  snippet: string;
}

export interface SqlExampleGroup {
  label: string;
  items: SqlExample[];
}

const pick = <T>(engine: DbEngine, options: Record<DbEngine, T>): T => options[engine];

export function sqlExamples(engine: DbEngine): SqlExampleGroup[] {
  const first = (n: string, rest: string) =>
    pick(engine, {
      firebird: `SELECT FIRST ${n} ${rest}`,
      sqlserver: `SELECT TOP ${n} ${rest}`,
      postgres: `SELECT ${rest}`,
      mysql: `SELECT ${rest}`,
    });
  const limitTail = (n: string) => (engine === 'postgres' || engine === 'mysql' ? `\nLIMIT ${n}` : '');
  const contains = pick(engine, {
    firebird: `\${2:coluna} CONTAINING '\${3:texto}'`,
    postgres: `\${2:coluna} ILIKE '%\${3:texto}%'`,
    mysql: `\${2:coluna} LIKE '%\${3:texto}%'`,
    sqlserver: `\${2:coluna} LIKE '%\${3:texto}%'`,
  });
  const today = pick(engine, {
    firebird: 'CURRENT_DATE',
    postgres: 'CURRENT_DATE',
    mysql: 'CURDATE()',
    sqlserver: 'CAST(GETDATE() AS DATE)',
  });
  const now = pick(engine, {
    firebird: 'CURRENT_TIMESTAMP',
    postgres: 'NOW()',
    mysql: 'NOW()',
    sqlserver: 'GETDATE()',
  });
  const concat = pick(engine, {
    firebird: `\${2:nome} || ' - ' || \${3:cidade}`,
    postgres: `\${2:nome} || ' - ' || \${3:cidade}`,
    mysql: `CONCAT(\${2:nome}, ' - ', \${3:cidade})`,
    sqlserver: `CONCAT(\${2:nome}, ' - ', \${3:cidade})`,
  });

  return [
    {
      label: 'Consultar',
      items: [
        {
          title: 'Primeiras linhas',
          description: 'Mostra só algumas linhas, para ver como a tabela é.',
          snippet: `${first('${2:10}', '*')}\nFROM \${1:tabela}${limitTail('${2:10}')};`,
        },
        {
          title: 'Filtrar por um valor',
          description: 'Linhas em que a coluna tem exatamente o valor (texto vai entre aspas simples).',
          snippet: "SELECT *\nFROM ${1:tabela}\nWHERE ${2:coluna} = ${3:'valor'};",
        },
        {
          title: 'Procurar texto',
          description: 'Linhas em que a coluna contém o texto, sem diferenciar maiúsculas.',
          snippet: `SELECT *\nFROM \${1:tabela}\nWHERE ${contains};`,
        },
        {
          title: 'Período de datas',
          description: 'Datas sempre no formato AAAA-MM-DD.',
          snippet:
            "SELECT *\nFROM ${1:tabela}\nWHERE ${2:data} BETWEEN '${3:2026-01-01}' AND '${4:2026-01-31}';",
        },
        {
          title: 'Ordenar',
          description: 'DESC = do maior para o menor (ou do mais novo para o mais antigo).',
          snippet: 'SELECT *\nFROM ${1:tabela}\nORDER BY ${2:coluna} ${3|DESC,ASC|};',
        },
        {
          title: 'Contar e agrupar',
          description: 'Quantas linhas há para cada valor da coluna.',
          snippet:
            'SELECT ${2:coluna}, COUNT(*) AS total\nFROM ${1:tabela}\nGROUP BY ${2:coluna}\nORDER BY total DESC;',
        },
        {
          title: 'Somar valores',
          description: 'Total, média, menor e maior de uma coluna numérica.',
          snippet:
            'SELECT COUNT(*) AS quantidade, SUM(${2:valor}) AS total, AVG(${2:valor}) AS media,\n       MIN(${2:valor}) AS menor, MAX(${2:valor}) AS maior\nFROM ${1:tabela};',
        },
        {
          title: 'Juntar duas tabelas (JOIN)',
          description: 'Traz dados das duas tabelas onde a chave bate. LEFT JOIN mantém quem não tem par.',
          snippet:
            'SELECT a.*, b.${5:nome}\nFROM ${1:pedidos} a\nJOIN ${2:clientes} b ON b.${3:id} = a.${4:cliente_id};',
        },
        {
          title: 'Encontrar duplicados',
          description: 'Valores que aparecem em mais de uma linha.',
          snippet:
            'SELECT ${2:coluna}, COUNT(*) AS vezes\nFROM ${1:tabela}\nGROUP BY ${2:coluna}\nHAVING COUNT(*) > 1;',
        },
        {
          title: 'Paginar',
          description: 'Pula as primeiras linhas e traz as próximas.',
          snippet: pick(engine, {
            firebird: 'SELECT FIRST ${2:50} SKIP ${3:100} *\nFROM ${1:tabela}\nORDER BY ${4:id};',
            sqlserver:
              'SELECT *\nFROM ${1:tabela}\nORDER BY ${4:id}\nOFFSET ${3:100} ROWS FETCH NEXT ${2:50} ROWS ONLY;',
            postgres: 'SELECT *\nFROM ${1:tabela}\nORDER BY ${4:id}\nLIMIT ${2:50} OFFSET ${3:100};',
            mysql: 'SELECT *\nFROM ${1:tabela}\nORDER BY ${4:id}\nLIMIT ${2:50} OFFSET ${3:100};',
          }),
        },
      ],
    },
    {
      label: 'Inserir',
      items: [
        {
          title: 'Inserir uma linha',
          description: 'Liste as colunas e os valores na mesma ordem. Texto entre aspas simples.',
          snippet:
            "INSERT INTO ${1:tabela} (${2:nome}, ${3:cidade})\nVALUES (${4:'João da Conceição'}, ${5:'São Paulo'});",
        },
        {
          title: 'Inserir várias linhas',
          description:
            engine === 'firebird'
              ? 'O Firebird 2.5 não aceita vários VALUES num comando: um INSERT por linha.'
              : 'Vários grupos de valores separados por vírgula.',
          snippet:
            engine === 'firebird'
              ? "INSERT INTO ${1:tabela} (${2:nome}) VALUES (${3:'Primeiro'});\nINSERT INTO ${1:tabela} (${2:nome}) VALUES (${4:'Segundo'});"
              : "INSERT INTO ${1:tabela} (${2:nome})\nVALUES (${3:'Primeiro'}),\n       (${4:'Segundo'});",
        },
        pick<SqlExample>(engine, {
          firebird: {
            title: 'Inserir com o próximo id',
            description:
              'No Firebird o id costuma vir de um generator (veja a lista em "Procedures e generators").',
            snippet:
              "INSERT INTO ${1:tabela} (${2:id}, ${3:nome})\nVALUES (GEN_ID(${4:GEN_TABELA_ID}, 1), ${5:'valor'})\nRETURNING ${2:id};",
          },
          postgres: {
            title: 'Inserir e ver o id gerado',
            description: 'RETURNING devolve as colunas da linha criada (inclusive o id automático).',
            snippet: "INSERT INTO ${1:tabela} (${2:nome})\nVALUES (${3:'valor'})\nRETURNING ${4:id};",
          },
          mysql: {
            title: 'Inserir e ver o id gerado',
            description: 'Rode o SELECT logo depois do INSERT, na mesma conexão.',
            snippet:
              "INSERT INTO ${1:tabela} (${2:nome})\nVALUES (${3:'valor'});\n\nSELECT LAST_INSERT_ID();",
          },
          sqlserver: {
            title: 'Inserir e ver o id gerado',
            description: 'OUTPUT devolve as colunas da linha criada (inclusive o id automático).',
            snippet: "INSERT INTO ${1:tabela} (${2:nome})\nOUTPUT INSERTED.${4:Id}\nVALUES (${3:N'valor'});",
          },
        }),
        {
          title: 'Copiar linhas de outra tabela',
          description: 'Insere o resultado de um SELECT.',
          snippet:
            'INSERT INTO ${1:destino} (${2:nome}, ${3:cidade})\nSELECT ${2:nome}, ${3:cidade}\nFROM ${4:origem}\nWHERE ${5:condicao};',
        },
      ],
    },
    {
      label: 'Alterar',
      items: [
        {
          title: 'Alterar um campo de uma linha',
          description: 'Sempre com WHERE: sem ele, todas as linhas mudam.',
          snippet: "UPDATE ${1:tabela}\nSET ${2:coluna} = ${3:'novo valor'}\nWHERE ${4:id} = ${5:1};",
        },
        {
          title: 'Alterar vários campos',
          description: 'Separe os campos por vírgula.',
          snippet:
            "UPDATE ${1:tabela}\nSET ${2:nome} = ${3:'novo nome'},\n    ${4:cidade} = ${5:'nova cidade'}\nWHERE ${6:id} = ${7:1};",
        },
        {
          title: 'Ajustar um valor (ex.: +10%)',
          description: 'O lado direito pode usar o valor atual da própria coluna.',
          snippet:
            "UPDATE ${1:produtos}\nSET ${2:preco} = ${2:preco} * ${3:1.10}\nWHERE ${4:categoria} = ${5:'Cozinha'};",
        },
        {
          title: 'Limpar um campo',
          description: 'NULL deixa o campo vazio (se a coluna permitir).',
          snippet: 'UPDATE ${1:tabela}\nSET ${2:coluna} = NULL\nWHERE ${3:id} = ${4:1};',
        },
        {
          title: 'Alterar a partir de outra tabela',
          description: 'Copia um valor de uma tabela relacionada.',
          snippet: pick(engine, {
            firebird:
              'UPDATE ${1:pedidos} p\nSET p.${2:cidade} = (SELECT c.${2:cidade} FROM ${3:clientes} c WHERE c.${4:id} = p.${5:cliente_id})\nWHERE EXISTS (SELECT 1 FROM ${3:clientes} c WHERE c.${4:id} = p.${5:cliente_id});',
            postgres:
              'UPDATE ${1:pedidos} p\nSET ${2:cidade} = c.${2:cidade}\nFROM ${3:clientes} c\nWHERE c.${4:id} = p.${5:cliente_id};',
            mysql:
              'UPDATE ${1:pedidos} p\nJOIN ${3:clientes} c ON c.${4:id} = p.${5:cliente_id}\nSET p.${2:cidade} = c.${2:cidade};',
            sqlserver:
              'UPDATE p\nSET p.${2:cidade} = c.${2:cidade}\nFROM ${1:pedidos} p\nJOIN ${3:clientes} c ON c.${4:id} = p.${5:cliente_id};',
          }),
        },
      ],
    },
    {
      label: 'Excluir',
      items: [
        {
          title: 'Conferir antes de excluir',
          description: 'Rode primeiro o SELECT com o mesmo WHERE e veja quantas linhas serão atingidas.',
          snippet: 'SELECT COUNT(*)\nFROM ${1:tabela}\nWHERE ${2:id} = ${3:1};',
        },
        {
          title: 'Excluir uma linha',
          description: 'Sempre com WHERE: sem ele, a tabela inteira é apagada.',
          snippet: 'DELETE FROM ${1:tabela}\nWHERE ${2:id} = ${3:1};',
        },
        {
          title: 'Excluir várias por lista',
          description: 'IN aceita uma lista de valores separados por vírgula.',
          snippet: 'DELETE FROM ${1:tabela}\nWHERE ${2:id} IN (${3:1, 2, 3});',
        },
        {
          title: 'Excluir com base em outra tabela',
          description: 'Apaga as linhas cujo valor aparece num SELECT.',
          snippet:
            "DELETE FROM ${1:itens}\nWHERE ${2:pedido_id} IN (SELECT ${3:id} FROM ${4:pedidos} WHERE ${5:status} = ${6:'cancelado'});",
        },
      ],
    },
    {
      label: 'Datas e textos',
      items: [
        {
          title: 'Hoje e agora',
          description: 'Data de hoje e data com hora, no formato deste banco.',
          snippet: `SELECT *\nFROM \${1:tabela}\nWHERE \${2:data} >= ${today};\n\n-- Data e hora atuais: ${now}`,
        },
        {
          title: 'Juntar textos',
          description: 'Monta um texto a partir de várias colunas.',
          snippet: `SELECT ${concat} AS descricao\nFROM \${1:tabela};`,
        },
        {
          title: 'Converter tipo',
          description: 'CAST troca o tipo de um valor (ex.: número para texto).',
          snippet: 'SELECT CAST(${2:coluna} AS ${3:VARCHAR(20)})\nFROM ${1:tabela};',
        },
        {
          title: 'Valor padrão para vazio',
          description: 'COALESCE troca NULL pelo valor indicado.',
          snippet: "SELECT COALESCE(${2:email}, ${3:'(sem e-mail)'})\nFROM ${1:tabela};",
        },
      ],
    },
  ];
}

/** Snippet como texto puro (o que fica no editor sem mudar nenhum campo). */
export function snippetText(snippet: string): string {
  return snippet
    .replace(/\$\{\d+\|([^,|}]*)[^}]*\|\}/g, '$1')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\d+/g, '');
}
