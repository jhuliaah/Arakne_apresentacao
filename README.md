# Arakne

> "Cada fio, uma mulher. Cada nó, uma confiança."

App de aprendizado de crochê/tecelagem que, sob a superfície, é uma rede de
microcrédito peer-to-peer via Lightning Network para mulheres sem acesso
bancário por controle financeiro coercitivo. O crochê é a superfície visível;
as funcionalidades financeiras são reveladas por gestos ocultos.

Projeto do hackathon **Hack4Freedom São Paulo 2026** (só mulheres).

---

## Visão Geral

Arakne é um app mobile-first que se apresenta como uma plataforma de
aprendizado de crochê — com 9 trilhas, 54 aulas e 127 materiais reais. Por
baixo desse disfarce, existe uma rede de microcrédito em Bitcoin/Lightning:
a usuária pode pedir empréstimos (em sats), receber via Pix, pagar dívidas,
e trocar crédito por dinheiro presencial com uma "Fornecedora de Linha"
da própria rede.

O disfarce não é cosmético — é requisito de segurança. O público-alvo são
mulheres sob controle financeiro coercitivo (Afeganistão, Índia, Nordeste
do Brasil, Colômbia). A tela inicial não mostra nenhum símbolo cripto ou
financeiro; a camada financeira só aparece após desenhar o "Ponto Arakne",
um padrão gestual que funciona como senha.

---

## Problema

Mulheres sob controle financeiro coercitivo não têm acesso a crédito,
conta bancária própria, ou independência financeira. O agressor controla
o celular, o extrato bancário, e qualquer sinal de atividade financeira
autônoma. Soluções de microcrédito tradicionais (Grameen Bank, SACCOs)
exigem presença física e identidade real — impossível para quem precisa
esconder a atividade do agressor.

---

## Solução

1. **Disfarce total:** o app é um catálogo de crochê genuíno. Nenhuma
   menção a dinheiro, cripto, ou empréstimo na superfície visível.
2. **Acesso por aval social:** uma mulher indica outra (voucher). Sem
   identidade real — só PIN + identificador opaco + chave Nostr.
3. **Microcrédito em sats via Lightning:** empréstimo instantâneo, sem
   banco, sem KYC. A dívida é em sats; o repagamento pode ser via Pix.
4. **Camada de gasto via Pix:** a usuária converte sats em BRL e paga
   contas, ou recebe depósitos via QR Pix.
5. **Ponto de Troca presencial:** uma "Fornecedora de Linha" da rede
   converte crédito da usuária em dinheiro em espécie, fora do app —
   para quem não pode usar Pix com segurança.
6. **Recuperação social:** se a usuária perde o aparelho ou esquece o
   padrão, suas "tecelãs de confiança" a ajudam a recuperar a conta via
   Shamir's Secret Sharing + gift-wrap Nostr (NIP-59).

---

## Stack de Tecnologia

### Arquitetura

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (React 18 + Vite + TypeScript)                  │
│  Máquina de estados (23 views, sem React Router)          │
│  PWA mobile-first · Tailwind · shadcn/ui                  │
│  Porta 5173 (dev) / Vercel (prod)                         │
├──────────────────────────────────────────────────────────┤
│  Backend (FastAPI + SQLAlchemy + SQLite)                   │
│  10 routers · 18 models · 139 testes (pytest)             │
│  Porta 8000 (dev) / Railway (prod)                        │
├──────────────────────────────────────────────────────────┤
│  Serviços externos (todos com fallback mock)              │
│  Coinos (Lightning) · Mercado Pago (Pix) · Binance (BRL)  │
│  embit (multisig offline) · Breez SDK (carteira mobile)   │
└──────────────────────────────────────────────────────────┘
```

### Backend — `backend/` (FastAPI + Python 3.12+)

| Camada | Tecnologia | Estado |
|---|---|---|
| API REST | FastAPI + Pydantic | ✅ 10 routers operacionais |
| Banco | SQLite via SQLAlchemy | ✅ `Base.metadata.create_all()` (sem Alembic) |
| Lightning (pool) | Coinos API (coinos.io) | ✅ integrado, fallback mock |
| Lightning (empréstimo) | Coinos API | ✅ integrado, fallback mock |
| Pix (repagamento) | Mercado Pago Checkout Transparente | ✅ real + mock |
| Pix (depósito carteira) | Mercado Pago + polling ativo | ✅ real + mock |
| Conversão BRL→sats | Binance API | ✅ código completo, fallback mock |
| Custódia fria | embit (multisig 2-de-3) | ✅ script offline funcional |
| Motor de risco | `services/risco.py` (4 tiers) | ✅ implementado e testado |
| Recuperação social | SSSS T=2 N=2 + NIP-59 | ✅ implementado |

### Frontend — `frontend/` (React 18 + Vite + TypeScript)

| Camada | Tecnologia |
|---|---|
| Framework | React 18 (sem React Router — máquina de estados manual) |
| Build | Vite 8 + TypeScript |
| Estilo | CSS custom + Cinzel/Fraunces/Inter (Google Fonts via @fontsource) |
| QR Code | `qrcode` (geração) + `jsqr` (leitura via câmera) |
| Cripto Nostr | `nostr-tools` (nsec/npub, gift-wrap NIP-59, NIP-44) |
| SSSS | `shamir-secret-sharing` (auditada por Cure53 e Zellic) |
| Cripto do padrão | WebCrypto nativo (AES-GCM-256 + PBKDF2 600k iterações) |
| Breez SDK | `@breeztech/breez-sdk-spark/web` (carteira não-custoidal) |
| Deploy | Vercel (`vercel.json` com SPA rewrites) |

### Docker (opcional, stack completa)

`docker-compose.yml` sobe Bitcoin Core (regtest) + LND + LNbits + backend
+ frontend. Para a demo, o modo mock dispensa Docker — basta o script
`dev-up.sh --mock`.

---

## Nostr — Identidade, Criptografia e Recuperação Social

O Arakne usa o protocolo **Nostr** (Notes and Other Stuff Transmitted over
Relays) como camada de identidade e comunicação criptografada para a
recuperação social de conta. Não usamos Nostr como rede social — usamos
apenas as primitivas criptográficas e de transporte que o protocolo oferece.

### Por que Nostr?

O modelo de ameaça exige que a recuperação de conta funcione **meses depois**
do cadastro, sem servidor central, sem telefone, e sem que nenhum intermediário
saiba quem pediu ajuda ou quem respondeu. Nostr resolve isso com:

- **Chaves em vez de contas:** a identidade da usuária é um par de chaves
  secp256k1 (nsec/npub), gerado localmente, sem registro em servidor.
- **Relays descentralizados:** mensagens gift-wrapped persistem em relays
  públicos; não há servidor da Arakne no meio da recuperação.
- **Criptografia ponta-a-ponta:** NIP-44 (chave de sessão efêmera + AES-GCM)
  garante que só o destinatário consegue ler o conteúdo.

### Geração de identidade (`nostr-keys.ts`)

A chave privada (nsec) é gerada com `generateSecretKey()` do `nostr-tools/pure`
— 32 bytes aleatórios criptograficamente seguros. **Não usamos NIP-06**
(derivação por mnemônico BIP-39), porque o protocolo Nostr marca o NIP-06
como `unrecommended`, e o modelo de recuperação social (SSSS + NIP-59) não
depende de seed frase. O npub (bech32, `npub1...`) é o identificador de
backup — muito mais curto que 12 palavras.

O nsec **nunca sai do dispositivo em plaintext**. Fica criptografado em
`localStorage` com AES-GCM-256, chave derivada do Ponto Arakne via PBKDF2
(600k iterações, WebCrypto nativo).

### Gift-wrap NIP-59 (`gift-wrap.ts`)

O NIP-59 cria uma camada de privacidade tripla sobre mensagens Nostr:

```
Rumor (kind 1, não assinado)
  └→ Seal (kind 13, NIP-44, assinado pelo remetente)
       └→ Wrap (kind 1059, chave efêmera aleatória, NIP-44)
            └→ publicado no relay
```

1. **Rumor** — o conteúdo real (um JSON com tipo `shard`, `request` ou
   `response`). Tem `pubkey` do autor mas sem `sig`, então não é um evento
   publicável nem rastreável.
2. **Seal** — assina o rumor com a chave do remetente e criptografa (NIP-44)
   para a chave pública do destinatário. O `created_at` é randomizado.
3. **Wrap** — envolve o seal com uma chave efêmera aleatória, criptografada
   (NIP-44) para o destinatário. Tag `p` = destinatário.

O relay só vê o wrap (kind 1059) com pubkey efêmera — **não sabe quem enviou,
não sabe quem recebeu, não sabe o conteúdo**. O destinatário desembrulha com
sua chave privada.

### Pool de relays (`nostr-pool.ts`)

Singleton `SimplePool` do `nostr-tools/pool` — uma instância para todo o app.
Publica em **3 relays hardcoded** com redundância (se 1-2 caírem, o wrap
sobrevive nos outros):

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.nostr.band`

- **Publish:** em todos os 3 relays simultaneamente (`Promise.allSettled`).
  Retorna `true` se ≥1 aceitou.
- **Subscribe:** round-robin em todos os 3. O `SimplePool` desduplica eventos
  por `id` automaticamente.
- **Query síncrono:** `querySync()` espera EOSE em todos os relays e retorna
  o histórico completo (para baixar wraps pendentes quando a usuária reabre
  o app).

### Recuperação social — fluxo completo

**Distribuição (no cadastro):**
1. O nsec da dona é dividido em 2 shares via SSSS (T=2, N=2).
2. **Share 0** → gift-wrapped (NIP-59) endereçado à convidadora (sua tecelã
   de confiança), publicado nos 3 relays.
3. **Share 1** → criptografada com o PIN da dona (AES-GCM) e enviada ao
   backend (`POST /usuarias/me/recovery-share`). O backend guarda só o
   blob opaco — nunca vê o PIN nem a share em plaintext.

**Recuperação (em novo dispositivo):**
1. A dona gera um nsec efêmero local (só para receber respostas).
2. Faz login com `identificador` + PIN → busca e decripta a share 1 do backend.
3. Gift-wrap um `request` endereçado à convidadora, publicado nos relays.
4. A convidadora (com o app aberto) recebe o wrap via subscribe, desembrulha,
   localiza a share 0 que guardou, e responde via gift-wrap com a share.
5. A dona combina share 0 + share 1 via SSSS e valida o pubkey do nsec
   reconstruído contra o npub esperado (`combineNsecWithCheck`).

**Por que SSSS e não só criptografia?** Porque `combine()` da lib
`shamir-secret-sharing` (auditada por Cure53 e Zellic) não detecta shares
incorretas ou adulteradas — retorna lixo deterministicamente. O
`combineNsecWithCheck()` deriva o pubkey do nsec reconstruído e compara com
o esperado antes de aceitar o resultado. Isso detecta shares misturadas,
adulteradas, ou de vaults diferentes.

### Fallback de recuperação por PIN

Se a conta não tem shares SSSS configuradas (caso de contas criadas via
`/demo-setup` sem passar pelo `RecoverySetupPage`), o sistema gera uma nova
identidade Nostr, vincula ao backend via `updateNpub`, e a dona desenha um
novo Ponto Arakne. O saldo, tier e empréstimos estão no backend (não no
nsec), então a conta é totalmente recuperável sem SSSS.

---

## Breez SDK — Carteira Lightning Não-Custodial

O **Breez SDK (Spark)** é a carteira Lightning individual da usuária —
não-custodial de verdade. A chave/seed nunca sai do dispositivo, nunca é
enviada ao backend. Isso é estrutural, não convenção: é o que diferencia
essa camada do pool (que **é** custodial de propósito, via Coinos no
backend).

### Por que não-custodial?

O pool do Arakne (fundo coletivo) é custodial por design — é uma
cooperativa de crédito, não uma carteira individual. Mas a carteira
pessoal da usuária (para receber depósitos, fazer pagamentos do dia a
dia) precisa ser dela: se o backend cair, se a operadora for embora, se
alguém confiscar o servidor — a usuária ainda tem seus sats. O Breez SDK
resolve isso rodando um nodo Lightning nodeless no próprio navegador
(WASM), sem servidor intermediário.

### Derivação da seed a partir do nsec

O Breez SDK exige uma mnemonic BIP-39 como formato de entrada. O Arakne
**não usa NIP-06** (derivação Nostr → BIP-39 por路径 HD), porque o
protocolo marca NIP-06 como `unrecommended`. Em vez disso, os mesmos 32
bytes do nsec são reinterpretados como **entropia BIP-39** via
`entropyToMnemonic()` da lib `bip39`:

```
nsec (32 bytes) → hex → entropyToMnemonic() → 24 palavras BIP-39
```

Isso é determinístico: o mesmo nsec sempre produz a mesma mnemonic, então
a carteira Breez de uma usuária é sempre recuperável a partir da mesma
identidade Nostr — sem precisar guardar/mostrar a mnemonic separadamente.
"Uma chave mestra, dois formatos de saída": o Nostr usa os bytes crus, o
Breez usa a mesma entropia codificada como 24 palavras.

### Operações (`breez-wallet.ts`)

| Função | O que faz |
|---|---|
| `initBreezWallet(nsecBytes, config)` | Inicializa o módulo WASM, deriva a mnemonic do nsec, conecta ao SDK |
| `getBalanceSats(sdk)` | Consulta saldo em sats via `sdk.getInfo()` |
| `receberPagamento(sdk, amount, desc)` | Gera invoice Lightning via `sdk.receivePayment()` |
| `prepararEnvio(sdk, destino)` | Cotação de taxa via `sdk.prepareSendPayment()` — não move nada ainda |
| `confirmarEnvio(sdk, resultado)` | Executa o pagamento via `sdk.sendPayment()` — gasta sats reais |

O fluxo de envio é sempre **dois passos**: primeiro `prepararEnvio()`
(mostra a taxa pra usuária confirmar), depois `confirmarEnvio()` (executa).
Nunca encadeia os dois sem confirmação humana no meio — é dinheiro real.

### Configuração

- **API key:** gratuita, obtida em [breez.technology](https://breez.technology)
  (formulário "Request API Key"). Sem ela, `connect()` falha — não existe
  modo mock aqui, porque não faz sentido simular uma carteira não-custodial:
  ou ela é real, ou não existe.
- **Variável:** `VITE_BREEZ_API_KEY` no `frontend/.env`
- **SDK:** `@breeztech/breez-sdk-spark/web` (subpath `/web` para SPA/browser)
- **WASM:** o módulo WebAssembly é carregado via `init()` antes de qualquer
  chamada — precisa rodar uma vez por sessão.

### Distinção pool vs. carteira individual

| | Pool (backend) | Carteira individual (frontend) |
|---|---|---|
| Custódia | Custodial (Coinos) | Não-custodial (Breez SDK) |
| Chave | JWT da conta-pool no `.env` | nsec da usuária (derivado) |
| Operação | Empréstimos, repagamento, conversão BRL | Depósito/gasto do dia a dia |
| Backend | `services/coinos.py` | Roda no navegador (WASM) |
| Mock | Sim (fallback automático) | Não (ou é real, ou não existe) |

---

## Fluxos de Tela (Frontend)

### Onboarding (aparelho novo)

```
Splash → CreateAccount (PIN + apelido opcional)
       → RecoverySetup (distribuir shares SSSS)
       → Catalog (trilhas de crochê)
```

### Login (aparelho com conta)

```
PatternLogin (desenhar Ponto Arakne) → Catalog
```

### Portal disfarçado

```
Trilha 9 → Nível 1 → Aula 1 ("Ponto Renascido")
         → HexPatternCanvas (desenhar padrão correto)
         → FinancialPage revelada
```

### FinancialPage ("Seu ateliê")

- Card de nível (tier) e saldo devedor ("padrão em andamento")
- Cesta de novelos (carteira): saldo em sats + conversão BRL
- Botões: "Puxar novelos" (empréstimo), "Receber novelos" (depósito),
  "Entregar novelos" (pagamento Pix), "Devolver novelos" (repagamento)
- Fornecedoras de Linha (pontos de troca)
- Tecelã de confiança (avalista de recuperação)
- Sino 🎀 (notificações de pedidos de recuperação social)

### Recuperação de conta

```
Splash → "Recuperar acesso"
       → "Tenho meu PIN" (identificador + PIN)
       → Fallback: gera nova identidade Nostr, vincula ao backend
       → Novo Ponto Arakne → Catalog
```

### Convite (link de indicação)

```
/convite/FUNDADORA_INVITE → InviteDecision
                          → Aceitar → CreateAccount (nasce tier 1)
```

---

## Segredos e Variáveis de Ambiente

O projeto tem **3 modos de operação**:

### Modo Mock (demo, zero credenciais)

```bash
bash scripts/dev-up.sh --mock
```

O script troca `.env` por `.env.mock` (todos os campos vazios), roda o
seed, sobe tudo. Ao encerrar (Ctrl+C), restaura o `.env` real. Nenhuma
chamada externa é feita — Coinos, Pix e Binance caem em mock automaticamente.

### Variáveis do backend (`.env`)

| Variável | Descrição | Vazio = |
|---|---|---|
| `COINOS_URL` | URL da API Coinos | default `https://coinos.io/api` |
| `COINOS_POOL_TOKEN` | JWT da conta-pool no Coinos | mock (sem Lightning real) |
| `MP_ACCESS_TOKEN` | Token Mercado Pago (Pix) | mock (sem PSP real) |
| `MP_WEBHOOK_URL` | URL pública para webhook do MP | polling manual |
| `PIX_NOME_RECEBEDOR` | Nome comercial no Pix | default cosmetic |
| `BINANCE_API_KEY` | API key Binance | mock (sem compra/saque) |
| `BINANCE_API_SECRET` | Secret Binance | mock |
| `MULTISIG_DESCRIPTOR` | Descriptor multisig 2-de-3 | endpoint informa "não configurado" |
| `MULTISIG_ENDERECO` | Endereço da reserva fria | idem |
| `MULTISIG_QUORUM` | Quórum (ex: `2-de-3`) | `2-de-3` |
| `MULTISIG_NETWORK` | Rede Bitcoin (`mainnet`/`regtest`) | `regtest` |

### Variáveis do frontend (`frontend/.env`)

| Variável | Descrição |
|---|---|
| `VITE_BREEZ_API_KEY` | Chave do Breez SDK (carteira não-custodial) |
| `VITE_API_URL` | URL do backend em prod (ex: Railway). Sem ela, usa `/api` (proxy vite) |

---

## Público-Alvo

Mulheres sem acesso bancário por controle financeiro coercitivo:

- **Afeganistão** — mulheres proibidas de ter conta bancária
- **Índia** — dote/controle familiar sobre finanças da mulher
- **Nordeste do Brasil** — dependência financeira em relações abusivas
- **Colômbia** — deslocadas internas sem documentação bancária

O disfarce de crochê é a proteção: o agressor que olha o celular vê um
app de artesanato. A camada financeira só aparece com o gesto secreto.

---

## Identidade de Marca

- **Mitof:** Aracne foi punida por Atena por tecer a verdade sobre os
  abusos dos deuses. "Aracne foi punida por tecer a verdade; a gente
  termina o que ela começou."
- **Paleta:** imperial blue, dourado, bordô, creme, dusk blue
- **Tipografia:** Cinzel (wordmark) · Fraunces (headings) · Inter (UI)
- **Vocabulário:** nenhum termo financeiro na UI. "Novelos" = sats,
  "ateliê" = carteira, "fios" = shares, "padrão concluído" = pagamento
  quitado, "aula de ponto" = pedido de ajuda na recuperação social.

---

## Motor de Crédito

| Tier | Requisito | Limite (sats) |
|---|---|---|
| 0 | Sem crédito | 0 |
| 1 | 1 aval (indicação) | 5.000 |
| 2 | Tier 1 quitado | 15.000 |
| 3 | Tier 2 quitado + indicação | 40.000 |

- Atraso > 14 dias → `tier_congelado` (especificado, scheduler pendente)
- Completar padrões de crochê não libera crédito
- Nunca reduz tier retroativamente

---

## Equipe

Projeto do hackathon Hack4Freedom São Paulo 2026 (equipe só de mulheres).

- **Jhulia Carvalho** — Arquitetura; business model; rail de pagamento
  Pix; fluxo financeiro; integração fiat/bitcoin.
- **Dilaine Oliveira** — Frontend; identificações Nostr; Recuperação;
  UX design; trilhas de aprendizado; implementação dos mecanismos de
  segurança e Ponto Arakne.

---

## Repositório e Links

- **Repo principal:** github.com/jhuliaah/Arakne
- **Deploy frontend:** Vercel (`vercel.json` incluído)
- **Deploy backend:** Railway (configurar env vars no painel)

---

## Como Rodar

### Demo em modo mock (recomendado para avaliadores)

```bash
bash scripts/dev-up.sh --mock
```

Isso sobe backend (:8000) + frontend (:5173) com zero credenciais reais.
Ao encerrar (Ctrl+C), o `.env` original é restaurado.

### Desenvolvimento local (com credenciais reais)

```bash
bash scripts/dev-up.sh --all   # seed + multisig + tunnel + sobe tudo
```

Ou manualmente:

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python seed_demo.py
uvicorn app.main:app --port 8000 --reload --reload-exclude "*.db"

# Frontend
cd frontend
npm install --legacy-peer-deps
npm run dev
```

### Credenciais demo

| Usuária | Identificador | PIN | Tier |
|---|---|---|---|
| Fundadora | `FUNDADORA` | `1234` | 3 |
| Fornecedora | `FORNECEDORA` | `1234` | 3 |
| Convidada | (criada na demo) | — | 1 |

Acesse `http://localhost:5173/demo-setup` para conectar o navegador à
conta Fundadora. Use `http://localhost:5173/convite/FUNDADORA_INVITE`
para criar uma convidada.

### Verificação rápida

| Verificação | Como |
|---|---|
| Backend no ar | `curl http://localhost:8000/health` |
| Frontend carregando | Abrir `http://localhost:5173` |
| Seed criou mestras | `python seed_demo.py` lista FUNDADORA + FORNECEDORA |
| Demo automatizada | `cd backend && python run_demo.py` (< 10s, mock) |
| Testes backend | `cd backend && pytest` (139 testes) |

---

## Status

### Arquitetura implementada e funcional

| Componente | Estado |
|---|---|
| Catálogo de crochê (9 trilhas, 54 aulas, 127 materiais) | ✅ |
| Portal disfarçado (trilha 9 → Ponto Arakne) | ✅ |
| FinancialPage (saldo, empréstimo, carteira, trocas) | ✅ |
| Motor de crédito (4 tiers, aval social) | ✅ |
| Empréstimo Lightning (Coinos) | ✅ |
| Repagamento via Pix (Mercado Pago) | ✅ |
| Depósito via Pix + polling ativo (sem webhook) | ✅ |
| Carteira interna (ledger TransacaoCarteira) | ✅ |
| Ponto de Troca (aprovação/recusa, reputação) | ✅ |
| Identidade Nostr (nsec direto, AES-GCM + PBKDF2) | ✅ |
| Recuperação social (SSSS T=2 N=2 + NIP-59 gift-wrap) | ✅ |
| Recuperação por PIN (fallback sem SSSS) | ✅ |
| Travamento após 8 tentativas (backoff exponencial) | ✅ |
| Custódia multisig 2-de-3 (script offline embit) | ✅ |
| Conversão BRL→sats (Binance API) | ✅ (código completo) |
| Breez SDK (carteira não-custoidal) | ✅ (tipagem corrigida) |
| Demo automatizada (run_demo.py) | ✅ |
| Modo mock completo (--mock no dev-up.sh) | ✅ |
| Deploy Vercel (vercel.json + VITE_API_URL) | ✅ |
| 139 testes pytest (backend) | ✅ |

---

## Próximos Passos (Roadmap)

### Pendências funcionais

| Item | Prioridade | Descrição |
|---|---|---|
| Scheduler de atraso | Alta | `ao_atrasar()` existe mas não é chamada — sem cron/job no repo |
| Webhook de depósito de carteira | Alta | Depósito confirma via polling, mas webhook próprio ainda falta |
| Proteção cambial do empréstimo | Alta | `valor_sats` e `valor_brl` são independentes — sem trava automática |
| Voucher com trava em sats | Média | Especificado (500 sats fixos, devolvidos na quitação), zero código |
| Boleto como canal alternativo | Média | Especificado, sem parser/gerador no repo |
| Liquidação Lightning do Ponto de Troca | Média | Confirmar/recusar funciona; mover sats entre carteiras não |
| QR único para Ponto de Troca | Média | Hoje usa identificador em texto |
| `vender_btc_mercado()` desconectado | Alta | Função pronta mas não chamada por `/carteira/pagar` |

### Arquitetura-alvo (pós-hackathon)

| Mecanismo | MVP hoje | Alvo |
|---|---|---|
| Custódia Lightning | Coinos (hospedado) | Nó próprio, mainnet |
| Custódia fria | Script demo | Stewards reais, rotação de chaves |
| Carteira da usuária | Breez SDK (avaliado) | Non-custodial de verdade |
| Repagamento | Pix (Mercado Pago) | + PJ com nome comercial dedicado |
| Proteção cambial | Não implementada | Denominação em moeda local + buffer 30-50% |
| Juros | Não implementado | Juros flutuantes com base na Selic, spread pra baixo |
| Multi-moeda | Campo `pais` faz gate | Rails por país (M-Pesa, UPI, etc.) |
| Camada de investimento | Wireframes | Staking do pool (pendente validação jurídica) |
| Governança do fundo | Não implementada | Multisig com stewards reais |

### Roadmap financeiro — gestão de risco e fundo de investimento

#### Gestão de risco (risk management)

O motor de crédito atual opera com 4 tiers baseados em aval social e
quitamento progressivo (ver seção Motor de Crédito). O roadmap prevê a
evolução para um sistema de risk management mais sofisticado:

- **Atraso automatizado:** `ao_atrasar()` já existe no código mas não é
  chamada por falta de scheduler. O objetivo é um job periódico que
  verifica empréstimos vencidos há mais de 14 dias e congela o tier da
  mutuária e da avalista automaticamente.
- **Voucher com trava em sats:** a avalista em tier ≥ 2 paga 500 sats
  fixos para liberar o link de indicação. A trava só é devolvida quando
  a avalizada quita o primeiro empréstimo — não quando o pega. Isso
  alinha incentivos: a avalista só indica quem ela confia de verdade.
- **Proteção cambial do empréstimo:** hoje `valor_sats` e
  `valor_brl` são independentes. O objetivo é denominar a dívida em
  moeda local (ex: BRL) com cotação travada no momento do empréstimo.
  O fundo absorve a diferença cambial — se o BTC subiu entre o
  empréstimo e o repagamento, a mutuária paga o mesmo valor em BRL; se
  caiu, o fundo absorve o prejuízo. Isso requer um buffer de 30–50% do
  fundo total como reserva cambial.
- **Juros flutuantes com base na Selic:** spread pra baixo (a mutuária
  paga menos que a taxa de mercado). O juro não é fixo — flutua com a
  taxa básica de juros do país, para que o fundo se mantenha sustentável
  em diferentes ciclos econômicos. O spread exato precisa ser calibrado
  junto com o buffer cambial.

#### Fundo de investimento (capitalização do pool)

O pool do Arakne é custodial e funciona como uma cooperativa de crédito:
mutuárias pedem empréstimos, repagam via Pix, e o BRL volta como sats
para o pool. Mas o pool precisa de capital inicial e de reposição —
especialmente quando há inadimplência ou variação cambial desfavorável.

O roadmap prevê uma **camada de investimento** separada do app principal:

- **Cotistas investem capital no pool** via posições de staking (a
  linguagem é DeFi — "posição", não "cota" — mas a substância
  regulatória é próxima de um FIDC brasileiro, o que é uma pendência
  jurídica real, não resolvida trocando o nome).
- **O principal investido nunca é sacado** — fica travado no pool como
  capital de base. O cotista só recebe o **lucro**, se houver,
  distribuído por ciclo mensal (estilo Curve/GMX).
- **O cotista não tem acesso ao app de crochê** — é um público
  diferente (investidoras, não mutuárias), com interface própria, sem
  disfarce têxtil, e PJ separada da entidade operacional.
- **A arquitetura prevê uma tabela `posicao_staking`** no mesmo backend,
  não um token — o sistema roda em Bitcoin/Lightning, não numa chain
  com contrato inteligente.

#### Segundo app (capitalização aberta)

Para escalar a capitalização do pool sem expor as mutuárias, o roadmap
prevê um **segundo app**, mais aberto, que **puxa do mesmo fundo**:

- O app principal (Arakne) continua disfarçado e focado nas mutuárias —
  crochê, microcrédito, recuperação social.
- O segundo app é aberto (sem disfarce), voltado para investidoras que
  querem aportar capital ao fundo. Ele se conecta ao **mesmo backend** e
  ao **mesmo pool Lightning**, mas tem uma interface própria de
  investimento/staking.
- Esse modelo permite que pessoas de fora da rede de mutuárias contribuam
  com capital (inclusive de fora do Brasil, via Lightning), sem precisar
  passar pelo onboarding de crochê nem pelo aval social.
- A separação de apps protege o disfarce: o agressor que encontrar o
  app de investimento não consegue rastrear a mutuária, e vice-versa.

### Inconsistências conhecidas

1. `ao_atrasar()` existe e está correta, mas não é chamada — atraso sem
   efeito automático.
2. Ledger de carteira (`TransacaoCarteira`) e saldo de gasto são duas
   fontes não reconciliadas (parcialmente mitigado pelo polling ativo).
3. `vender_btc_mercado()` pronta mas não chamada por `/carteira/pagar`.
4. Modelos órfãos (`Padrao`, `ProgressoPadrao`) — design de disfarce
   anterior, superado por `Trilha`/`Aula`/`Material`.

---

## Licença

Projeto de hackathon. Todos os direitos reservados às autoras.
