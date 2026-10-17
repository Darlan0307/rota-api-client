import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Entry } from '@napi-rs/keyring';
import { APP_DATA_FOLDER, appDataDir } from '../paths';
import { EncryptedFileSecretStore } from './secret-store';

const KEYRING_ACCOUNT = 'secrets-master-key';

/**
 * Lê (ou cria na primeira vez) a chave mestra no Windows Credential Manager.
 * O Credential Manager é protegido por DPAPI e acessível só pelo usuário logado.
 */
export function keyringMasterKey(service = APP_DATA_FOLDER): Buffer {
  const entry = new Entry(service, KEYRING_ACCOUNT);
  const existing = entry.getPassword();
  if (existing) return Buffer.from(existing, 'base64');
  const key = randomBytes(32);
  entry.setPassword(key.toString('base64'));
  return key;
}

/** Store padrão usado pelo app e pelo MCP: um arquivo de segredos por workspace. */
export function createSecretStore(workspaceLocalDir: string): EncryptedFileSecretStore {
  return new EncryptedFileSecretStore(join(workspaceLocalDir, 'secrets.json'), () => keyringMasterKey());
}

/** Caminho padrão dos dados locais (re-exportado por conveniência). */
export { appDataDir };
