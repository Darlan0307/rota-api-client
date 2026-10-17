import type { ExampleFile } from '../model/schemas';
import { type ContractReport, compareJsonBodies } from './shape';

export interface ContractCheck {
  example: Pick<ExampleFile, 'id' | 'name' | 'savedAt'> & { status: number };
  report: ContractReport;
}

/**
 * Exemplo de referência para uma resposta: o mais recente com o mesmo status
 * cujo corpo seja JSON. Sem exemplo com o mesmo status não há comparação
 * (um 404 não deve ser comparado com o exemplo de sucesso).
 */
export function referenceExample(examples: readonly ExampleFile[], status: number): ExampleFile | undefined {
  return examples
    .filter((e) => e.response.status === status)
    .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
    .find((e) => compareJsonBodies(e.response.body, e.response.body) !== undefined);
}

/** Compara a resposta com o exemplo de referência (undefined se não houver como comparar). */
export function checkContract(
  examples: readonly ExampleFile[],
  status: number,
  body: string,
  exampleId?: string,
): ContractCheck | undefined {
  const example = exampleId ? examples.find((e) => e.id === exampleId) : referenceExample(examples, status);
  if (!example) return undefined;
  const report = compareJsonBodies(example.response.body, body);
  if (!report) return undefined;
  return {
    example: {
      id: example.id,
      name: example.name,
      savedAt: example.savedAt,
      status: example.response.status,
    },
    report,
  };
}
