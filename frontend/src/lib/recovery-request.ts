/** recovery-request — orquestra o pedido de recuperação em novo dispositivo.
 *
 *  Track 4A da Fase 4 do plano de recuperação Nostr do Arakne (Opção E).
 *
 *  Cenário: a usuária perdeu o aparelho (ou esqueceu o padrão de desbloqueio),
 *  está num dispositivo novo, e sabe o `identificador` da conta + seu PIN.
 *  Modelo Opção E: T=2, N=2.
 *  - Share 1 está no backend, criptografada com o PIN da dona. A dona
 *    autentica (login com identificador + PIN) e busca a share 1.
 *  - Share 0 está com a convidadora (enviada via NIP-59 na configuração).
 *    A dona envia um pedido NIP-59 à convidadora, que responde com a share.
 *  - Se a dona não tem convidadora (0 avalistas), a share 0 vem de um
 *    backup de papel — responsabilidade da UI/caller.
 *
 *  Fluxo do pedido:
 *  1. `startRecoveryRequest(identificador, pin)`:
 *     a. Gera um nsec efêmero (chave temporária — a dona não tem seu nsec
 *        original neste dispositivo, então precisa de uma chave só para receber
 *        as respostas da convidadora).
 *     b. Busca no backend (sem auth) o npub antigo da dona e os avalistas
 *        (0 ou 1 — a convidadora), pelo `identificador`.
 *     c. Faz login no backend com (identificador, pin) e busca a share 1
 *        (`fetchRecoveryShare`), decriptando com `decryptWithPin(blob, pin)`.
 *     d. Se houver convidadora: gift-wrap (NIP-59) um rumor `request`
 *        endereçado ao npub dela, assinado com o nsec efêmero. Publica em
 *        todos os relays hardcoded.
 *     e. Retorna o nsec efêmero + a share 1 do backend.
 *  2. `subscribeToRecoveryResponses(ephemeralNsec, cb, ownerNpub)`:
 *     a. Inscreve para receber gift-wraps (kind 1059) endereçados ao npub
 *        efêmero (em tempo real, em todos os relays).
 *     b. Para cada wrap recebido, desembrulha com o nsec efêmero. Se o rumor
 *        interno for `type: "response"` com `approved: true` e `share` presente,
 *        decodifica a share (base64 → bytes) e chama o callback.
 *  3. Quando o caller junta share 1 (backend) + share 0 (convidadora),
 *     chama `tryCombineShares(backendShare, convidadoraResponses,
 *     ownerNpub)` para reconstruir o nsec via SSSS e validar o pubkey.
 *
 *  Modelo de ameaça:
 *  - O nsec efêmero NUNCA sai do dispositivo. Ele só desembrulha respostas
 *    endereçadas a ele (NIP-44). O relay vê apenas wraps kind 1059 com pubkey
 *    efêmera — não sabe quem é a dona nem quais são as avalistas.
 *  - O pedido `request` vai dentro de um gift-wrap endereçado à convidadora.
 *    Só a convidadora (com seu nsec) consegue desembrulhar e ler o
 *    `initiatorNpub` (npub efêmero) para onde deve enviar a resposta.
 *  - A share 1 do backend é decriptada localmente com o PIN — o backend
 *    nunca vê o PIN nem a share em plaintext.
 *  - A validação final (`combineNsecWithCheck`) deriva o pubkey do nsec
 *    reconstruído e compara com o `expectedOwnerNpub`. Isso detecta shares
 *    adulteradas ou misturadas (SSSS puro não detecta — retorna lixo).
 *
 *  ARMADILHA: `combineNsecWithCheck` é async (a lib `shamir-secret-sharing`
 *  usa Promise internamente). Por isso `tryCombineShares` é async, embora a
 *  spec original sugerisse sync. O caller precisa `await`.
 */

import { wrapToRecipient, unwrapReceived } from "./gift-wrap";
import { publishEvent, subscribeWrapsForNpub } from "./nostr-pool";
import { decodeNpub, decodeNsec } from "./nostr-keys";
import { base64ToBytes } from "./recovery-serialize";
import { combineNsecWithCheck, T } from "./ssss";
import { decryptWithPin } from "./pattern-crypto";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import type { RecoveryRumor } from "./recovery-types";
import { RECOVERY_TAGS } from "./recovery-types";
import {
  getNpubByIdentificador,
  getAvalistasByIdentificador,
  login,
  setToken,
  setIdentificador,
  setPin,
  fetchRecoveryShare,
} from "../api";

/** Resultado de `startRecoveryRequest()`. */
export interface RecoveryRequestResult {
  /** npub (bech32) da chave temporária — para debug/UI. */
  ephemeralNpub: string;
  /** nsec (bytes) da chave temporária — guarda para desembrulhar respostas. */
  ephemeralNsec: Uint8Array;
  /** Quantos pedidos foram publicados com sucesso (≥1 relay aceitou). */
  published: number;
  /** Quantos pedidos falharam (todos os relays rejeitaram). */
  failed: number;
  /** Share 1 decriptada do backend (ou null se fetch/decrypt falhou).
   *  Combinar com a share 0 da convidadora (ou backup de papel). */
  backendShare: Uint8Array | null;
  /** True se o login falhou (PIN incorreto). P2 (auditoria item 9):
   *  permite a UI mostrar "PIN incorreto" imediatamente em vez de
   *  esperar 60s de timeout quando há convidadora (published > 0). */
  loginFailed: boolean;
}

/** Uma share recebida da convidadora em resposta ao pedido de recuperação. */
export interface RecoveryResponse {
  /** npub (bech32) da convidadora que respondeu — derivado do pubkey do seal. */
  avalistaNpub: string;
  /** Bytes da share SSSS (33 bytes cada: 1 byte índice + 32 bytes payload). */
  share: Uint8Array;
  /** Identificador do vault (para casar com o pedido original). */
  vaultId: string;
}

/**
 * Inicia o pedido de recuperação (Opção E).
 *
 * Fluxo:
 * 1. Gera nsec efêmero (chave temporária para receber respostas)
 * 2. Busca npub antigo + avalistas no backend (pelo identificador)
 * 3. Faz login no backend com (identificador, pin) e busca a share 1,
 *    decriptando com o PIN
 * 4. Se houver convidadora: gift-wrap um pedido (kind 1059) endereçado a ela
 * 5. Publica em todos os relays
 * 6. Retorna o nsec efêmero + a share 1 do backend
 *
 * @param identificador - identificador da conta da dona (string do backend)
 * @param pin - PIN da dona (autentica no backend e decripta a share 1)
 * @returns resultado com nsec efêmero + share 1 do backend
 * @throws se o backend não encontrar o npub (identificador inválido,
 *   backend offline, etc.)
 */
export async function startRecoveryRequest(
  identificador: string,
  pin: string,
): Promise<RecoveryRequestResult> {
  // 1. Gera nsec efêmero (32 bytes aleatórios) e deriva o npub.
  const ephemeralNsec = generateSecretKey();
  const ephemeralPubHex = getPublicKey(ephemeralNsec);
  const ephemeralNpub = nip19.npubEncode(ephemeralPubHex);

  // 2. Busca npub antigo da dona no backend (endpoint público, sem auth).
  const oldNpub = await getNpubByIdentificador(identificador);
  if (!oldNpub) {
    throw new Error(
      `startRecoveryRequest: npub não encontrado para identificador "${identificador}" ` +
        `(backend offline ou conta inexistente).`,
    );
  }

  // 3. Busca os avalistas de recuperação no backend (endpoint público).
  // Opção E: 0 (sem convidadora) ou 1 (a convidadora).
  const avalistas = await getAvalistasByIdentificador(identificador);
  if (!avalistas) {
    throw new Error(
      `startRecoveryRequest: não foi possível buscar avalistas para identificador "${identificador}".`,
    );
  }

  // 4. Autentica no backend com (identificador, pin) e busca a share 1.
  // A dona está num dispositivo novo — precisa fazer login para obter
  // token antes de GET /usuarias/me/recovery-share.
  //
  // Defesa em profundidade (BUG 3): chamamos setPin(pin) além de
  // setIdentificador + setToken. Assim, se o token direto abaixo falhar
  // por qualquer motivo (race, latência, backend reiniciado), o
  // ensureToken() consegue re-logar com o PIN — sem setPin, getPin()
  // retornaria null e a recuperação quebraria mesmo com PIN correto.
  let backendShare: Uint8Array | null = null;
  let loginFailed = false;
  try {
    setIdentificador(identificador);
    setPin(pin);
    const loginResp = await login(identificador, pin);
    if (loginResp) {
      setToken(loginResp.token);
      // Passa o token direto para evitar o round-trip getMe do
      // ensureToken — mais robusto contra race condition/latência.
      const blob = await fetchRecoveryShare(loginResp.token);
      if (blob) {
        backendShare = await decryptWithPin(blob, pin);
      }
    } else {
      // P2 (auditoria item 9): login falhou (PIN incorreto). Marca para
      // a UI poder mostrar feedback imediato em vez de esperar timeout.
      loginFailed = true;
    }
  } catch (err) {
    console.error(
      "[recovery-request] falha ao buscar/decriptar share 1 do backend:",
      err,
    );
  }

  // 5. Se houver convidadora: gift-wrap um pedido e publica.
  let published = 0;
  let failed = 0;

  for (const avalista of avalistas) {
    const avalistaNpub = avalista.npub_avaliadora;

    let avalistaPubHex: string;
    try {
      avalistaPubHex = decodeNpub(avalistaNpub);
    } catch (err) {
      failed++;
      console.error(
        `[recovery-request] npub de avalista inválido: ${avalistaNpub}`,
        err,
      );
      continue;
    }

    const rumorContent: RecoveryRumor = {
      type: "request",
      ownerNpub: oldNpub,
      vaultId: "",
      initiatorNpub: ephemeralNpub,
      message: "Uma de suas aranhinhas pediu uma aula sobre o Ponto Arakne, pode ajudar?",
      createdAt: Math.floor(Date.now() / 1000),
    };

    const wrap = wrapToRecipient(
      ephemeralNsec,
      avalistaPubHex,
      rumorContent,
      [["t", RECOVERY_TAGS.request]],
    );

    try {
      const ok = await publishEvent(wrap);
      if (ok) {
        published++;
      } else {
        failed++;
        console.error(
          `[recovery-request] pedido para ${avalistaNpub} falhou em todos os relays`,
        );
      }
    } catch (err) {
      failed++;
      console.error(
        `[recovery-request] erro ao publicar pedido para ${avalistaNpub}:`,
        err,
      );
    }
  }

  return {
    ephemeralNpub,
    ephemeralNsec,
    published,
    failed,
    backendShare,
    loginFailed,
  };
}

/**
 * Inicia o pedido de recuperação pelo caminho nsec (Mudança #3).
 *
 * Cenário: a usuária perdeu o aparelho mas AINDA TEM o nsec (anotado
 * em papel, ou colado de outro lugar). Neste caso, ela não precisa do
 * PIN nem da share 1 do backend — só precisa desembrulhar a share 0
 * que está com a convidadora via NIP-59.
 *
 * Fluxo:
 * 1. Decodifica o nsec fornecido → deriva o npub da dona.
 * 2. Busca os avalistas de recuperação no backend pelo npub. Como o
 *    endpoint público é por `identificador` (não por npub), e a dona
 *    pode não lembrar o identificador neste caminho, aceitamos o
 *    identificador opcional. Se não fornecido, não há como buscar
 *    avalistas — o caller deve tratar.
 * 3. Gera nsec efêmero, gift-wrap um pedido a cada convidadora e
 *    publica nos relays.
 * 4. Retorna o nsec efêmero + o npub da dona (para validação final
 *    em `tryCombineShares`). A share 1 do backend fica null (não
 *    buscada — a dona tem o nsec, não precisa da share 1).
 *
 * Nota: este caminho NÃO substitui o SSSS — ele só pula a busca da
 * share 1 do backend (que a dona não precisa, pois já tem o nsec).
 * A share 0 ainda vem da convidadora via NIP-59 e é combinada com...
 * na verdade, se a dona já tem o nsec, ela não precisa combinar
 * shares — pode adotar o nsec direto. Mas mantemos o fluxo SSSS para
 * o caso de a dona ter o nsec ANOTADO mas querer validar com a
 * convidadora (cenário raro). O caller decide: se tem nsec, pode
 * pular o combine e ir direto para `adoptRecoveredIdentity`.
 *
 * @param nsecBech32 - nsec da dona (nsec1...) — a chave privada original
 * @param identificador - identificador da conta (para buscar avalistas).
 *   Se não souber, passe null — o caller precisa de outro jeito de
 *   achar as convidadoras (raro).
 * @returns resultado com nsec efêmero + npub da dona. backendShare
 *   é sempre null neste caminho.
 * @throws se o nsec for inválido ou se não conseguir buscar avalistas
 */
export async function startRecoveryRequestWithNsec(
  nsecBech32: string,
  identificador: string | null,
): Promise<RecoveryRequestResult & { ownerNpub: string }> {
  // 1. Decodifica o nsec fornecido → bytes → deriva npub.
  let nsecBytes: Uint8Array;
  try {
    nsecBytes = decodeNsec(nsecBech32);
  } catch (err) {
    throw new Error(
      `startRecoveryRequestWithNsec: nsec inválido: ${(err as Error).message}`,
    );
  }
  if (nsecBytes.length !== 32) {
    throw new Error(
      `startRecoveryRequestWithNsec: nsec tem ${nsecBytes.length} bytes, esperado 32.`,
    );
  }
  const ownerPubHex = getPublicKey(nsecBytes);
  const ownerNpub = nip19.npubEncode(ownerPubHex);

  // 2. Gera nsec efêmero para receber as respostas.
  const ephemeralNsec = generateSecretKey();
  const ephemeralPubHex = getPublicKey(ephemeralNsec);
  const ephemeralNpub = nip19.npubEncode(ephemeralPubHex);

  // 3. Busca avalistas no backend (precisa do identificador).
  let avalistas: { npub_avaliadora: string }[] = [];
  if (identificador) {
    const lista = await getAvalistasByIdentificador(identificador);
    if (lista) {
      avalistas = lista.map((a) => ({ npub_avaliadora: a.npub_avaliadora }));
    }
  }

  // 4. Gift-wrap um pedido a cada convidadora e publica.
  let published = 0;
  let failed = 0;

  for (const avalista of avalistas) {
    const avalistaNpub = avalista.npub_avaliadora;
    let avalistaPubHex: string;
    try {
      avalistaPubHex = decodeNpub(avalistaNpub);
    } catch (err) {
      failed++;
      console.error(
        `[recovery-request] npub de avalista inválido: ${avalistaNpub}`,
        err,
      );
      continue;
    }

    const rumorContent: RecoveryRumor = {
      type: "request",
      ownerNpub,
      vaultId: "",
      initiatorNpub: ephemeralNpub,
      message: "Uma de suas aranhinhas pediu uma aula sobre o Ponto Arakne, pode ajudar?",
      createdAt: Math.floor(Date.now() / 1000),
    };

    const wrap = wrapToRecipient(
      ephemeralNsec,
      avalistaPubHex,
      rumorContent,
      [["t", RECOVERY_TAGS.request]],
    );

    try {
      const ok = await publishEvent(wrap);
      if (ok) {
        published++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      console.error(
        `[recovery-request] erro ao publicar pedido para ${avalistaNpub}:`,
        err,
      );
    }
  }

  return {
    ephemeralNpub,
    ephemeralNsec,
    published,
    failed,
    backendShare: null,
    ownerNpub,
    loginFailed: false,
  };
}

/**
 * Inscreve para receber respostas de recuperação no npub efêmero.
 * Quando uma avalista responde com uma share, o callback é chamado.
 *
 * @param ephemeralNsec - nsec da chave temporária (gerada em startRecoveryRequest)
 * @param onResponse - callback chamado para cada share recebida
 * @param _expectedOwnerNpub - npub da dona (para validar combine depois —
 *   passado para referência futura; a validação real acontece em
 *   `tryCombineShares`, não aqui, porque o rumor `response` não carrega
 *   ownerNpub)
 * @returns função de cleanup (chamar para parar a inscrição)
 */
export function subscribeToRecoveryResponses(
  ephemeralNsec: Uint8Array,
  onResponse: (response: RecoveryResponse) => void,
  _expectedOwnerNpub: string,
): () => void {
  // Deriva pubkey efêmero (hex) para o filtro do subscribe.
  const ephemeralPubHex = getPublicKey(ephemeralNsec);

  // Inscreve para receber gift-wraps (kind 1059) endereçados ao npub efêmero.
  const cleanup = subscribeWrapsForNpub(ephemeralPubHex, (wrap) => {
    // Tenta desembrulhar com o nsec efêmero. Se a chave estiver errada
    // (wrap não era para nós) ou o evento for inválido, retorna null.
    const unwrapped = unwrapReceived(wrap, ephemeralNsec);
    if (!unwrapped) return;

    // Só processa rumores do tipo `response`.
    if (unwrapped.content.type !== "response") return;

    const response = unwrapped.content;
    // Só processa respostas aprovadas com share presente.
    if (!response.approved) return;
    if (!response.share) return;

    // Decodifica a share de base64 → bytes (33 bytes cada).
    let shareBytes: Uint8Array;
    try {
      shareBytes = base64ToBytes(response.share);
    } catch (err) {
      console.error(
        "[recovery-request] share base64 inválida, ignorando:",
        err,
      );
      return;
    }

    // Converte pubkey hex da avalista (do seal) → npub bech32.
    let avalistaNpub: string;
    try {
      avalistaNpub = nip19.npubEncode(unwrapped.pubkey);
    } catch {
      // Fallback: se falhar a codificação, usa o hex (não deveria acontecer).
      avalistaNpub = unwrapped.pubkey;
    }

    const recoveryResponse: RecoveryResponse = {
      avalistaNpub,
      share: shareBytes,
      vaultId: response.vaultId,
    };

    onResponse(recoveryResponse);
  });

  return cleanup;
}

/**
 * Tenta reconstruir o nsec a partir da share do backend + respostas da
 * convidadora. Precisa de pelo menos `threshold` (T=2) shares no total.
 *
 * @param backendShare - share 1 decriptada do backend (ou null se falhou)
 * @param convidadoraResponses - shares recebidas da convidadora via NIP-59
 * @param expectedOwnerNpub - npub da dona para validar (bech32 npub1...)
 * @returns nsec reconstruído (32 bytes), ou null se shares insuficientes/inválidas
 *
 * ARMADILHA: esta função é `async` (não `sync` como a spec original sugeria)
 * porque `combineNsecWithCheck` delega para `shamir-secret-sharing.combine()`
 * que retorna Promise. O caller precisa `await`.
 */
export async function tryCombineShares(
  backendShare: Uint8Array | null,
  convidadoraResponses: RecoveryResponse[],
  expectedOwnerNpub: string,
): Promise<Uint8Array | null> {
  // 1. Junta as shares disponíveis: backend (share 1) + convidadora (share 0).
  const shares: Uint8Array[] = [];
  if (backendShare) shares.push(backendShare);
  for (const r of convidadoraResponses) shares.push(r.share);

  // 2. Precisa de pelo menos T=2 shares.
  if (shares.length < T) {
    return null;
  }

  // 3. Pega as primeiras T shares (já basta para reconstruir).
  const selected = shares.slice(0, T);

  // 4. Decodifica o npub bech32 da dona → hex (para o check de validação).
  let expectedOwnerPubHex: string;
  try {
    expectedOwnerPubHex = decodeNpub(expectedOwnerNpub);
  } catch (err) {
    console.error(
      "[recovery-request] expectedOwnerNpub inválido:",
      err,
    );
    return null;
  }

  // 5. Combina as shares e valida o pubkey. Se lançar erro (shares
  //    adulteradas, de vaults diferentes, etc.), retorna null.
  try {
    const recovered = await combineNsecWithCheck(selected, expectedOwnerPubHex);
    return recovered;
  } catch (err) {
    console.error(
      "[recovery-request] reconstrução do nsec falhou (shares inválidas?):",
      err,
    );
    return null;
  }
}
