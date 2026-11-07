/**
 * ngrok: URL pública fixa com a conta do usuário. Só textos e regras aqui
 * (sem Node); a conexão usa o SDK oficial no processo principal do app.
 */

export const NGROK_AUTHTOKEN_URL = 'https://dashboard.ngrok.com/get-started/your-authtoken';
export const NGROK_DOMAINS_URL = 'https://dashboard.ngrok.com/domains';

/**
 * "https://x.ngrok-free.app/", "x.ngrok-free.app" → "x.ngrok-free.app".
 * null quando não parece um domínio.
 */
export function normalizeNgrokDomain(input: string): string | null {
  const text = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  if (text === '') return '';
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(text) ? text : null;
}

/** O authtoken tem cara de authtoken (evita salvar o comando inteiro colado do painel). */
export function cleanNgrokAuthtoken(input: string): string {
  const text = input.trim();
  // Colou "ngrok config add-authtoken XXXX" do painel.
  const fromCommand = /add-authtoken\s+(\S+)/i.exec(text)?.[1];
  return (fromCommand ?? text).replace(/^["']|["']$/g, '');
}

/** Explica, em português, os erros mais comuns do ngrok (o SDK devolve ERR_NGROK_XXX em inglês). */
export function describeNgrokError(message: string): string {
  const code = /ERR_NGROK_(\d+)/.exec(message)?.[1];
  switch (code) {
    case '105':
    case '106':
    case '107':
    case '4018':
      return `O authtoken do ngrok foi recusado (inválido, revogado ou de outra conta). Copie de novo em ${NGROK_AUTHTOKEN_URL} e salve no túnel.`;
    case '108':
      return 'Sua conta do ngrok já tem um agente conectado (o plano grátis permite um por vez). Feche o ngrok aberto em outro terminal ou computador e tente de novo.';
    case '334':
      return 'Esse domínio já está em uso por outro túnel ngrok (aqui ou em outro computador). Desligue o outro e tente de novo.';
    case '313':
    case '319':
    case '320':
    case '15013':
      return `Esse domínio não pertence à sua conta do ngrok. Deixe o campo "Domínio" vazio para usar o domínio grátis da conta ou confira em ${NGROK_DOMAINS_URL}.`;
    case '725':
    case '726':
    case '727':
    case '728':
      return 'A conta do ngrok atingiu o limite de uso do plano (tráfego ou requisições do mês). O limite volta no dia 1º; até lá, use um túnel da Cloudflare.';
  }
  if (/failed to (dial|connect)|dns|timed? ?out|network is unreachable|connection refused/i.test(message))
    return 'Sem conexão com o ngrok. Verifique a internet, VPN ou firewall da rede.';
  const firstLine = message.split('\n')[0]?.trim() || 'erro desconhecido';
  return `O ngrok recusou o túnel: ${firstLine}`;
}
