/**
 * Variáveis dinâmicas: `{{$cpf}}`, `{{$nomeCompleto}}`, `{{$guid}}`... Cada
 * ocorrência gera um valor novo a cada envio (como no Postman). Os dados de
 * pessoa e endereço são brasileiros; CPF e CNPJ têm dígitos verificadores válidos.
 */

export type DynamicCategory = 'pessoa' | 'documentos' | 'endereco' | 'empresa' | 'datas' | 'tecnico';

export interface DynamicVariable {
  /** Nome com o "$" (ex.: "$cpf"). */
  name: string;
  description: string;
  category: DynamicCategory;
  generate: () => string;
  /** Nome do Postman mantido por compatibilidade (não aparece na lista principal). */
  postmanAlias?: boolean;
}

export const DYNAMIC_CATEGORY_LABELS: Record<DynamicCategory, string> = {
  pessoa: 'Pessoa',
  documentos: 'Documentos',
  endereco: 'Endereço',
  empresa: 'Empresa',
  datas: 'Datas',
  tecnico: 'Técnicas',
};

// ---------------------------------------------------------------------------
// Aleatoriedade

function int(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(list: readonly T[]): T {
  return list[int(0, list.length - 1)] as T;
}

function digits(count: number): number[] {
  return Array.from({ length: count }, () => int(0, 9));
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHANUMERIC = `${LETTERS}${LETTERS.toLowerCase()}0123456789`;

function letters(count: number): string {
  return Array.from({ length: count }, () => pick([...LETTERS])).join('');
}

function withoutAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysFromToday(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

// ---------------------------------------------------------------------------
// Documentos

/** Dígito verificador no padrão módulo 11 da Receita (CPF e CNPJ). */
function mod11(values: readonly number[], weights: readonly number[]): number {
  const sum = values.reduce((acc, v, i) => acc + v * (weights[i] ?? 0), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

const CPF_WEIGHTS_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_WEIGHTS_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function generateCpf(): string {
  let base = digits(9);
  // Sequências repetidas (111.111.111-11) são inválidas.
  while (base.every((d) => d === base[0])) base = digits(9);
  const d1 = mod11(base, CPF_WEIGHTS_1);
  const d2 = mod11([...base, d1], CPF_WEIGHTS_2);
  return [...base, d1, d2].join('');
}

export function generateCnpj(): string {
  // 8 dígitos da raiz + 0001 (matriz).
  const base = [...digits(8), 0, 0, 0, 1];
  const d1 = mod11(base, CNPJ_WEIGHTS_1);
  const d2 = mod11([...base, d1], CNPJ_WEIGHTS_2);
  return [...base, d1, d2].join('');
}

export function isValidCpf(value: string): boolean {
  const n = value.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  const d = [...n].map(Number);
  return mod11(d.slice(0, 9), CPF_WEIGHTS_1) === d[9] && mod11(d.slice(0, 10), CPF_WEIGHTS_2) === d[10];
}

export function isValidCnpj(value: string): boolean {
  const n = value.replace(/\D/g, '');
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const d = [...n].map(Number);
  return mod11(d.slice(0, 12), CNPJ_WEIGHTS_1) === d[12] && mod11(d.slice(0, 13), CNPJ_WEIGHTS_2) === d[13];
}

const formatCpf = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const formatCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

// ---------------------------------------------------------------------------
// Pessoas, endereços e empresas

const FIRST_NAMES = [
  'Ana',
  'Beatriz',
  'Bruna',
  'Camila',
  'Carla',
  'Débora',
  'Fernanda',
  'Gabriela',
  'Helena',
  'Isabela',
  'Juliana',
  'Larissa',
  'Letícia',
  'Luana',
  'Mariana',
  'Natália',
  'Patrícia',
  'Rafaela',
  'Sofia',
  'Vitória',
  'André',
  'Bruno',
  'Caio',
  'Daniel',
  'Eduardo',
  'Felipe',
  'Gabriel',
  'Gustavo',
  'Henrique',
  'João',
  'Lucas',
  'Marcelo',
  'Mateus',
  'Paulo',
  'Pedro',
  'Rafael',
  'Rodrigo',
  'Thiago',
  'Vinícius',
  'Wesley',
] as const;

const LAST_NAMES = [
  'Silva',
  'Santos',
  'Oliveira',
  'Souza',
  'Rodrigues',
  'Ferreira',
  'Alves',
  'Pereira',
  'Lima',
  'Gomes',
  'Costa',
  'Ribeiro',
  'Martins',
  'Carvalho',
  'Almeida',
  'Lopes',
  'Soares',
  'Fernandes',
  'Vieira',
  'Barbosa',
  'Rocha',
  'Dias',
  'Nascimento',
  'Andrade',
  'Moreira',
  'Nunes',
  'Marques',
  'Machado',
  'Mendes',
  'Freitas',
] as const;

const CITIES: readonly (readonly [string, string, string])[] = [
  ['São Paulo', 'SP', '11'],
  ['Campinas', 'SP', '19'],
  ['Rio de Janeiro', 'RJ', '21'],
  ['Niterói', 'RJ', '21'],
  ['Belo Horizonte', 'MG', '31'],
  ['Uberlândia', 'MG', '34'],
  ['Vitória', 'ES', '27'],
  ['Curitiba', 'PR', '41'],
  ['Londrina', 'PR', '43'],
  ['Florianópolis', 'SC', '48'],
  ['Joinville', 'SC', '47'],
  ['Porto Alegre', 'RS', '51'],
  ['Salvador', 'BA', '71'],
  ['Recife', 'PE', '81'],
  ['Fortaleza', 'CE', '85'],
  ['Natal', 'RN', '84'],
  ['João Pessoa', 'PB', '83'],
  ['Maceió', 'AL', '82'],
  ['Aracaju', 'SE', '79'],
  ['São Luís', 'MA', '98'],
  ['Teresina', 'PI', '86'],
  ['Belém', 'PA', '91'],
  ['Manaus', 'AM', '92'],
  ['Goiânia', 'GO', '62'],
  ['Brasília', 'DF', '61'],
  ['Cuiabá', 'MT', '65'],
  ['Campo Grande', 'MS', '67'],
];

const STREET_TYPES = ['Rua', 'Avenida', 'Travessa', 'Alameda'] as const;
const STREET_NAMES = [
  'das Flores',
  'Brasil',
  'Sete de Setembro',
  'XV de Novembro',
  'Getúlio Vargas',
  'Santos Dumont',
  'Tiradentes',
  'das Palmeiras',
  'São João',
  'Dom Pedro II',
  'Rui Barbosa',
  'dos Andradas',
  'da Paz',
] as const;
const NEIGHBORHOODS = [
  'Centro',
  'Jardim América',
  'Vila Nova',
  'Boa Vista',
  'Santa Cecília',
  'Bela Vista',
  'Jardim Europa',
  'Liberdade',
  'Copacabana',
  'Savassi',
  'Batel',
  'Moinhos de Vento',
  'Pituba',
  'Boa Viagem',
] as const;
const COMPANY_WORDS = [
  'Horizonte',
  'Aurora',
  'Atlântica',
  'Pioneira',
  'Nacional',
  'Central',
  'Vértice',
  'Prisma',
  'Ipê',
  'Jequitibá',
  'Cerrado',
  'Litoral',
  'Serra Azul',
  'Nova Era',
] as const;
const COMPANY_SECTORS = [
  'Tecnologia',
  'Logística',
  'Alimentos',
  'Comércio',
  'Serviços',
  'Engenharia',
  'Saúde',
  'Distribuidora',
] as const;
const COMPANY_SUFFIXES = ['Ltda', 'S.A.', 'ME', 'EIRELI'] as const;
const EMAIL_DOMAINS = ['exemplo.com.br', 'teste.com.br', 'email.com', 'exemplo.com'] as const;

const firstName = () => pick(FIRST_NAMES);
const lastName = () => pick(LAST_NAMES);
const fullName = () => `${firstName()} ${lastName()} ${lastName()}`;

function email(): string {
  const user = withoutAccents(`${firstName()}.${lastName()}`).toLowerCase();
  return `${user}${int(1, 999)}@${pick(EMAIL_DOMAINS)}`;
}

function mobile(): { ddd: string; number: string } {
  return { ddd: pick(CITIES)[2], number: `9${int(6, 9)}${digits(7).join('')}` };
}

function mercosulPlate(): string {
  return `${letters(3)}${int(0, 9)}${letters(1)}${int(0, 9)}${int(0, 9)}`;
}

function birthDate(): string {
  // Adultos entre 18 e 80 anos.
  return isoDate(daysFromToday(-int(18 * 365 + 5, 80 * 365)));
}

// ---------------------------------------------------------------------------
// Catálogo

export const DYNAMIC_VARIABLES: readonly DynamicVariable[] = [
  // Pessoa
  { name: '$nome', category: 'pessoa', description: 'Primeiro nome', generate: firstName },
  { name: '$sobrenome', category: 'pessoa', description: 'Sobrenome', generate: lastName },
  { name: '$nomeCompleto', category: 'pessoa', description: 'Nome e dois sobrenomes', generate: fullName },
  { name: '$email', category: 'pessoa', description: 'E-mail fictício', generate: email },
  {
    name: '$celular',
    category: 'pessoa',
    description: 'Celular formatado',
    generate: () => {
      const { ddd, number } = mobile();
      return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    },
  },
  {
    name: '$celularNumeros',
    category: 'pessoa',
    description: 'Celular só com números (DDD + número)',
    generate: () => {
      const { ddd, number } = mobile();
      return `${ddd}${number}`;
    },
  },
  {
    name: '$dataNascimento',
    category: 'pessoa',
    description: 'Data de nascimento de um adulto (AAAA-MM-DD)',
    generate: birthDate,
  },

  // Documentos
  { name: '$cpf', category: 'documentos', description: 'CPF válido, só números', generate: generateCpf },
  {
    name: '$cpfFormatado',
    category: 'documentos',
    description: 'CPF válido com pontos e traço',
    generate: () => formatCpf(generateCpf()),
  },
  { name: '$cnpj', category: 'documentos', description: 'CNPJ válido, só números', generate: generateCnpj },
  {
    name: '$cnpjFormatado',
    category: 'documentos',
    description: 'CNPJ válido com pontos, barra e traço',
    generate: () => formatCnpj(generateCnpj()),
  },
  {
    name: '$placa',
    category: 'documentos',
    description: 'Placa de carro no padrão Mercosul',
    generate: mercosulPlate,
  },

  // Endereço
  {
    name: '$cep',
    category: 'endereco',
    description: 'CEP formatado (fictício)',
    generate: () => `${digits(5).join('')}-${digits(3).join('')}`,
  },
  {
    name: '$logradouro',
    category: 'endereco',
    description: 'Rua/avenida com número',
    generate: () => `${pick(STREET_TYPES)} ${pick(STREET_NAMES)}, ${int(1, 2500)}`,
  },
  { name: '$bairro', category: 'endereco', description: 'Bairro', generate: () => pick(NEIGHBORHOODS) },
  {
    name: '$cidade',
    category: 'endereco',
    description: 'Cidade brasileira',
    generate: () => pick(CITIES)[0],
  },
  { name: '$uf', category: 'endereco', description: 'Sigla do estado', generate: () => pick(CITIES)[1] },

  // Empresa
  {
    name: '$empresa',
    category: 'empresa',
    description: 'Razão social fictícia',
    generate: () => `${pick(COMPANY_WORDS)} ${pick(COMPANY_SECTORS)} ${pick(COMPANY_SUFFIXES)}`,
  },

  // Datas
  {
    name: '$hoje',
    category: 'datas',
    description: 'Data de hoje (AAAA-MM-DD)',
    generate: () => isoDate(new Date()),
  },
  {
    name: '$dataFutura',
    category: 'datas',
    description: 'Data entre amanhã e daqui a um ano',
    generate: () => isoDate(daysFromToday(int(1, 365))),
  },
  {
    name: '$dataPassada',
    category: 'datas',
    description: 'Data entre ontem e um ano atrás',
    generate: () => isoDate(daysFromToday(-int(1, 365))),
  },
  {
    name: '$timestamp',
    category: 'datas',
    description: 'Segundos desde 1970 (Unix)',
    generate: () => String(Math.floor(Date.now() / 1000)),
  },
  {
    name: '$isoTimestamp',
    category: 'datas',
    description: 'Data e hora atuais em ISO 8601',
    generate: () => new Date().toISOString(),
  },

  // Técnicas
  { name: '$guid', category: 'tecnico', description: 'UUID v4', generate: () => crypto.randomUUID() },
  {
    name: '$randomInt',
    category: 'tecnico',
    description: 'Inteiro entre 0 e 1000',
    generate: () => String(int(0, 1000)),
  },
  {
    name: '$codigo',
    category: 'tecnico',
    description: 'Código alfanumérico de 8 caracteres',
    generate: () => Array.from({ length: 8 }, () => pick([...ALPHANUMERIC])).join(''),
  },
  {
    name: '$preco',
    category: 'tecnico',
    description: 'Valor com duas casas decimais (10.00 a 999.99)',
    generate: () => (int(1000, 99999) / 100).toFixed(2),
  },
  {
    name: '$booleano',
    category: 'tecnico',
    description: 'true ou false',
    generate: () => String(Math.random() < 0.5),
  },

  // Nomes do Postman (coleções importadas continuam funcionando).
  {
    name: '$randomUUID',
    category: 'tecnico',
    description: 'UUID v4',
    generate: () => crypto.randomUUID(),
    postmanAlias: true,
  },
  {
    name: '$randomFirstName',
    category: 'pessoa',
    description: 'Primeiro nome',
    generate: firstName,
    postmanAlias: true,
  },
  {
    name: '$randomLastName',
    category: 'pessoa',
    description: 'Sobrenome',
    generate: lastName,
    postmanAlias: true,
  },
  {
    name: '$randomFullName',
    category: 'pessoa',
    description: 'Nome completo',
    generate: fullName,
    postmanAlias: true,
  },
  {
    name: '$randomEmail',
    category: 'pessoa',
    description: 'E-mail fictício',
    generate: email,
    postmanAlias: true,
  },
  {
    name: '$randomPhoneNumber',
    category: 'pessoa',
    description: 'Telefone',
    generate: () => {
      const { ddd, number } = mobile();
      return `${ddd}${number}`;
    },
    postmanAlias: true,
  },
  {
    name: '$randomCity',
    category: 'endereco',
    description: 'Cidade',
    generate: () => pick(CITIES)[0],
    postmanAlias: true,
  },
  {
    name: '$randomBoolean',
    category: 'tecnico',
    description: 'true ou false',
    generate: () => String(Math.random() < 0.5),
    postmanAlias: true,
  },
  {
    name: '$randomAlphaNumeric',
    category: 'tecnico',
    description: 'Um caractere alfanumérico',
    generate: () => pick([...ALPHANUMERIC]),
    postmanAlias: true,
  },
];

const BY_NAME = new Map(DYNAMIC_VARIABLES.map((v) => [v.name, v]));

export const DYNAMIC_VARIABLE_NAMES = DYNAMIC_VARIABLES.map((v) => v.name);

export function findDynamicVariable(name: string): DynamicVariable | undefined {
  return BY_NAME.get(name);
}

/** Gera um valor novo (undefined se o nome não for de uma variável dinâmica). */
export function generateDynamic(name: string): string | undefined {
  return BY_NAME.get(name)?.generate();
}
