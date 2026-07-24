# Arakne — Guia de Execução e Navegação

> Instruções para rodar o app em modo demo (mock) e navegar pelas telas.

---

## 1. Pré-requisitos

- **Python 3.12+**
- **Node 20+**
- **Git**

Não é necessário Docker, Bitcoin Core, LND, nem contas reais para rodar
em modo mock.

---

## 2. Como rodar (modo mock — zero credenciais)

### Opção A — Script automático (recomendado)

```bash
git clone git@github.com:jhuliaah/sao-paulo-2026.git
cd sao-paulo-2026/arakne
bash scripts/dev-up.sh --mock
```

O script faz tudo:

1. Cria venv do Python e instala dependências do backend
2. Instala dependências do frontend (`npm install --legacy-peer-deps`)
3. Troca `.env` por `.env.mock` (todos os campos vazios → mock)
4. Roda o seed (cria FUNDADORA + FORNECEDORA + 9 trilhas/54 aulas/127 materiais)
5. Sobe backend na porta 8000
6. Sobe frontend na porta 5173
7. Ao pressionar **Ctrl+C**: encerra tudo e **restaura** o `.env` original

### Opção B — Manual

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.mock ../.env        # modo mock
python seed_demo.py            # cria contas + trilhas
uvicorn app.main:app --port 8000 --reload-exclude "*.db"

# Frontend (outro terminal)
cd frontend
npm install --legacy-peer-deps
npm run dev
```

### Verificação rápida

| Verificação | Como |
|---|---|
| Backend no ar | `curl http://localhost:8000/health` → `{"status":"ok"}` |
| Frontend carregando | Abrir `http://localhost:5173` |
| Seed correu | `cd backend && python seed_demo.py` lista FUNDADORA + FORNECEDORA |
| Demo automatizada | `cd backend && python run_demo.py` (< 10s, mock) |
| Testes | `cd backend && pytest` (139 testes) |

---

## 3. Credenciais demo

| Usuária | Identificador | PIN | Tier | Descrição |
|---|---|---|---|---|
| Fundadora | `FUNDADORA` | `1234` | 3 | Mestra, pode convidar |
| Fornecedora | `FORNECEDORA` | `1234` | 3 | Mestra, ponto de troca |
| Convidada | (criada na demo) | — | 1 | Nasce pelo link de convite |

---

## 4. Roteiro de navegação (passo a passo)

### Cena 1 — O disfarce (2 min)

1. Abrir `http://localhost:5173` — catálogo de trilhas de crochê
2. Navegar pelas 9 trilhas (Ponto Baixo, Ponto Alto, Ponto Renascido...)
3. Abrir uma trilha → ver aulas e materiais (vídeos, PDFs, imagens)
4. **Ponto chave:** nenhuma menção a dinheiro, cripto, ou empréstimo

### Cena 2 — Conectar a conta (demo-setup)

1. Abrir `http://localhost:5173/demo-setup`
2. Os campos já vêm preenchidos com `FUNDADORA` / `1234`
3. Clicar em **"Conectar a esta conta"**
4. O app gera um nsec/npub, faz login, e mostra os dados:
   - Identificador: `FUNDADORA`
   - PIN: `1234`
   - Padrão (Ponto Arakne): `0 → 1 → 2 → 3 → 4 → 5`
5. Clicar em **"Ir para o app"** → cai no catálogo

### Cena 3 — O portal (2 min)

1. No catálogo, abrir a **trilha 9** ("Ponto Renascido")
2. Nível 1 → Aula 1
3. A aula não tem conteúdo de crochê — mostra um canvas hexagonal
4. Desenhar o Ponto Arakne: tocar os 6 vértices do primeiro hexágono
   no sentido **horário, começando do topo**:
   ```
   0 → 1 → 2 → 3 → 4 → 5
   ```
5. Se o padrão estiver correto → **FinancialPage revelada** ("Seu ateliê")
6. Se errar → volta ao catálogo normal (nenhuma mensagem de erro aparece)

### Cena 4 — A FinancialPage (2 min)

A FinancialPage ("Seu ateliê") mostra:

- **Card de nível:** tier atual (3) e saldo devedor ("padrão em andamento")
- **Cesta de novelos:** saldo em sats + conversão BRL
- **Botões de ação:**
  - "Puxar novelos" → solicitar empréstimo
  - "Receber novelos" → gerar QR Pix para depósito
  - "Entregar novelos" → pagar comerciante via Pix
  - "Devolver novelos" → repagar empréstimo
- **Fornecedoras de Linha:** lista de pontos de troca disponíveis
- **Tecelã de confiança:** avalista de recuperação
- **Sino 🎀:** notificações de pedidos de recuperação social

### Cena 5 — Solicitar microcrédito (1 min)

1. Na FinancialPage, clicar em **"Puxar novelos"**
2. Informar valor em sats (ex: 1000)
3. Confirmar → cria empréstimo (mock Lightning)
4. Ver saldo devedor aumentar + empréstimo na lista

### Cena 6 — Repagamento (2 min)

1. Clicar em **"Devolver novelos"** num empréstimo ativo
2. Escolher valor em sats para abater
3. Gera QR Pix (mock — código fake, confirmação automática)
4. Ver "Pagamento confirmado! Novelos devolvidos."
5. Saldo devedor abaixa; se zerar → tier sobe

### Cena 7 — Cesta de novelos (carteira) (1 min)

1. Na FinancialPage, ver o card **"Cesta de novelos"**
2. Clicar **"Receber novelos"** → tela de transação
3. Selecionar país (Brasil habilita pagamento Pix)
4. Informar valor em BRL → gera QR Pix para depósito (mock)
5. Clicar **"Entregar novelos"** → informe chave Pix + valor → envia Pix (mock)

### Cena 8 — Ponto de Troca (1 min)

1. Na FinancialPage, ver a seção **"Fornecedoras de Linha"**
2. A FORNECEDORA aparece como ponto de troca disponível
3. (Para testar: conectar como FORNECEDORA em outra aba via `/demo-setup`)

### Cena 9 — Recuperação de conta (2 min)

1. Sair da conta (botão "Sair" no PerfilPage — **não** apagar identidade)
2. Na tela inicial, clicar **"Recuperar acesso"**
3. Escolher **"Tenho meu PIN"**
4. Informar identificador (`FUNDADORA`) + PIN (`1234`)
5. Desenhar um **novo** Ponto Arakne (qualquer padrão com ≥ 8 pontos)
6. Conta recuperada → cai no catálogo

### Cena 10 — Convite (criar convidada)

1. Abrir `http://localhost:5173/convite/FUNDADORA_INVITE` (outra aba)
2. Tela de convite → clicar **"Iniciar um novo projeto com este convite"**
3. Criar conta: escolher PIN + apelido opcional
4. A convidada nasce em **tier 1** (aval automático da Fundadora)

---

## 5. Glossário — termos financeiros vs. termos de crochê

O app usa vocabulário têxtil em toda a UI. Nenhum termo financeiro aparece
para a usuária. Esta tabela é a tradução interna:

| Termo real (backend/API) | Termo na interface (crochê) |
|---|---|
| Saldo (sats) | Material disponível / cesta de novelos |
| Depósito | Repor material / receber novelos |
| Saque / pagamento | Usar material / entregar novelos |
| Empréstimo (pedido) | Novo kit / puxar novelos |
| Extrato | Registro |
| Dívida em aberto | Kit em aberto / padrão em andamento |
| Pagamento quitado | Padrão concluído |
| Pedido de vouch (aval) | Fio puxado |
| Avalista | Tecelã de confiança |
| Notificação de ajuda | "Aula de ponto" / sino 🎀 |
| Ponto de troca (câmbio) | Fornecedora de Linha |
| Tier (nível de crédito) | Nível da bancada |
| Saldo devedor | Padrão em andamento |
| Carteira | Cesta de novelos |
| Identificador | Código do ateliê |
| PIN | Código de reserva |
| Shares SSSS | Fios de sustentação |
| Recuperação social | Reatar fios |
| Travamento (lockout) | "A aranha está tecendo..." |
| Conversão BRL→sats | (invisível — acontece no backend) |
| Pool (fundo) | Ateliê central |

---

## 6. Padrão do Ponto Arakne (demo)

O padrão de demo é fixo: **6 vértices do primeiro hexágono**, no sentido
horário, começando do topo:

```
    0
  /   \
 5     1
 |     |
 4     2
  \   /
    3
```

Sequência: `0 → 1 → 2 → 3 → 4 → 5`

Necessário para entrar no app após recarregar a página (quando a sessão
expira). Em modo de registro (novo padrão), o mínimo é 8 pontos.
