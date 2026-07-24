"""Router for Usuaria endpoints.

Covers:
- POST /usuarias — create a pseudonymous account (with optional npub + invite code)
- GET /usuarias/me — current user data
- GET /usuarias/me/convite — invite link (tier 3+)
- GET /usuarias/me/avalistas-recuperacao — recovery avalistas (auth)
- GET /usuarias/by-identificador/{id}/npub — public npub lookup (no auth)
- GET /usuarias/by-identificador/{id}/avalistas-recuperacao — public recovery
  avalistas lookup (no auth; npub is public by design)
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import (
    generate_codigo_indicacao,
    generate_identificador,
    get_current_usuaria,
    hash_pin,
)
from app.database import get_db
from app.models.aval import Aval
from app.models.avalista_recuperacao import AvalistaRecuperacao
from app.models.recovery_share_backup import RecoveryShareBackup
from app.models.usuaria import Usuaria
from app.schemas.avalista_recuperacao import (
    AvalistasRecuperacaoListResponse,
    AvalistaRecuperacaoOut,
    NpubPublicoResponse,
    VincularMentorIn,
)
from app.schemas.recovery_share_backup import (
    RecoveryShareBackupIn,
    RecoveryShareBackupOut,
)
from app.schemas.usuaria import (
    ApelidoUpdate,
    ConviteResponse,
    NpubUpdate,
    PaisUpdate,
    UsuariaCreate,
    UsuariaResponse,
)
from app.services.bech32 import to_npub
from app.services.coinos import coinos as lnbits
from app.services.risco import ao_receber_aval, pode_avalizar

router = APIRouter(prefix="/usuarias", tags=["usuarias"])


# ── Helpers ───────────────────────────────────────────────────

def _create_recovery_shadows(
    db: Session,
    usuaria: Usuaria,
    referrer: Usuaria | None,
) -> None:
    """Cria os slots de avalista de recuperação para uma nova usuária.

    Estratégia "Option E" (T=2, N=2):
      - Share 0: enviado à convidadora via Nostr gift-wrap (frontend).
        Se a convidadora tiver npub, criamos 1 slot aqui (ordem=1,
        is_shadow=False) para que o frontend saiba para qual npub enviar
        o gift-wrap. Se a convidadora não tiver npub, NENHUM slot é
        criado — a dona usa o paper backup do share 0 (frontend).
      - Share 1: criptografado com PIN pelo frontend e guardado pelo
        backend via POST /usuarias/me/recovery-share. Não vira slot
        de npub aqui — o backend não faz cripto Nostr.
    """
    if referrer is not None and referrer.npub:
        db.add(
            AvalistaRecuperacao(
                usuaria_id=usuaria.id,
                npub_avaliadora=referrer.npub,
                ordem=1,
                is_shadow=False,
            )
        )


def _build_avalista_out(
    db: Session,
    slot: AvalistaRecuperacao,
) -> AvalistaRecuperacaoOut:
    """Constrói AvalistaRecuperacaoOut populando `apelido` a partir da
    Usuaria dona do npub (lookup por npub normalizado em bech32).

    O npub armazenado em AvalistaRecuperacao.npub_avaliadora pode estar em
    hex ou bech32; o npub em Usuaria.npub também. Normalizamos ambos para
    bech32 para comparar. Se não houver match (ex.: shadow com npub sem
    usuária correspondente), `apelido` fica None.
    """
    out = AvalistaRecuperacaoOut.model_validate(slot)
    if not slot.npub_avaliadora:
        return out
    npub_norm = to_npub(slot.npub_avaliadora)
    dona = (
        db.query(Usuaria)
        .filter(Usuaria.npub.isnot(None))
        .filter(Usuaria.apelido.isnot(None))
        .all()
    )
    for u in dona:
        if to_npub(u.npub) == npub_norm:
            out.apelido = u.apelido
            break
    return out


def _build_avalistas_out(
    db: Session,
    slots: list[AvalistaRecuperacao],
) -> list[AvalistaRecuperacaoOut]:
    return [_build_avalista_out(db, s) for s in slots]


# ── Endpoints ─────────────────────────────────────────────────

@router.post(
    "",
    response_model=UsuariaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Criar nova usuária",
    description="Cria uma conta pseudônima — só pede um PIN, nenhum dado de identidade real. "
    "Se codigo_indicacao for fornecido, cria o Aval automaticamente e libera tier 1. "
    "O npub (chave pública Nostr) é opcional e usado para recuperação social via Nostr. "
    "No cadastro, slots de avalistas de recuperação são criados automaticamente "
    "(estratégia Option E, T=2 N=2: 1 convidadora via Nostr + 1 share guardada pelo "
    "backend criptografada com PIN da usuária). Se a convidadora tiver npub, cria-se "
    "1 slot (ordem=1, is_shadow=False); se não tiver npub, nenhum slot é criado e a "
    "dona usa paper backup para o share 0.",
)
def create_usuaria(
    payload: UsuariaCreate,
    db: Session = Depends(get_db),
):
    referrer: Usuaria | None = None

    # Validate referral code if provided
    if payload.codigo_indicacao:
        referrer = (
            db.query(Usuaria)
            .filter(Usuaria.codigo_indicacao == payload.codigo_indicacao)
            .first()
        )
        if not referrer:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Código de indicação inválido",
            )

    # Validate npub uniqueness if provided
    if payload.npub:
        existing = (
            db.query(Usuaria).filter(Usuaria.npub == payload.npub).first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="npub já cadastrado para outra usuária",
            )

    # Generate unique identificador (retry on collision)
    identificador = generate_identificador()
    while db.query(Usuaria).filter(Usuaria.identificador == identificador).first():
        identificador = generate_identificador()

    # Generate unique codigo_indicacao (retry on collision)
    codigo = generate_codigo_indicacao()
    while db.query(Usuaria).filter(Usuaria.codigo_indicacao == codigo).first():
        codigo = generate_codigo_indicacao()

    # Create dedicated LNbits wallet for this user
    wallet = lnbits.create_wallet(f"usuaria_{identificador}")

    usuaria = Usuaria(
        identificador=identificador,
        pin_hash=hash_pin(payload.pin),
        lnbits_wallet_key=wallet["adminkey"],
        codigo_indicacao=codigo,
        codigo_indicacao_usado=payload.codigo_indicacao,
        npub=payload.npub,
        apelido=payload.apelido,
        pais=payload.pais,
    )
    db.add(usuaria)
    db.flush()  # get the id without committing yet

    # If a referral code was provided, create the Aval automatically
    if referrer:
        aval = Aval(
            usuaria_que_avaliza_id=referrer.id,
            nova_usuaria_id=usuaria.id,
        )
        db.add(aval)
        usuaria.avalista_id = referrer.id
        ao_receber_aval(usuaria)  # tier 0 → 1

    # Auto-create os slots de avalista de recuperação (estratégia Option E)
    _create_recovery_shadows(db, usuaria, referrer)

    db.commit()
    db.refresh(usuaria)
    return usuaria


@router.get(
    "/me",
    response_model=UsuariaResponse,
    summary="Dados da própria usuária",
    description="Retorna os dados da usuária autenticada. Nunca expõe pin_hash, avalista_id, ou id interno.",
)
def get_me(current_usuaria: Usuaria = Depends(get_current_usuaria)):
    return current_usuaria


@router.patch(
    "/me/npub",
    response_model=UsuariaResponse,
    summary="Atualizar npub da usuária logada",
    description="Atualiza o npub (chave pública Nostr) da usuária autenticada. "
    "Usado pela página de setup da demo para definir o npub da Fundadora "
    "após a geração do par nsec/npub no frontend. Valida unicidade — "
    "rejeita se o npub já pertence a outra usuária. Permite atualizar "
    "um npub já definido (upsert).",
)
def update_npub(
    payload: NpubUpdate,
    current_usuaria: Usuaria = Depends(get_current_usuaria),
    db: Session = Depends(get_db),
):
    # Se o npub é igual ao já armazenado, retorna sem alterar (idempotente).
    if current_usuaria.npub == payload.npub:
        return current_usuaria

    # Valida unicidade — rejeita se outra usuária já tem esse npub.
    existing = (
        db.query(Usuaria)
        .filter(Usuaria.npub == payload.npub)
        .filter(Usuaria.id != current_usuaria.id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="npub já cadastrado para outra usuária",
        )

    current_usuaria.npub = payload.npub
    db.commit()
    db.refresh(current_usuaria)
    return current_usuaria


@router.patch(
    "/me/apelido",
    response_model=UsuariaResponse,
    summary="Atualizar apelido da usuária logada",
    description="Atualiza o apelido público da usuária autenticada (1 a 80 chars, "
    "sem whitespace nas bordas). O apelido é exibido em telas de vinculação "
    "de tecelãs em vez do npub truncado. Pode ser definido ou sobrescrito a "
    "qualquer momento após o cadastro.",
)
def update_apelido(
    payload: ApelidoUpdate,
    current_usuaria: Usuaria = Depends(get_current_usuaria),
    db: Session = Depends(get_db),
):
    current_usuaria.apelido = payload.apelido
    db.commit()
    db.refresh(current_usuaria)
    return current_usuaria


@router.patch(
    "/me/pais",
    response_model=UsuariaResponse,
    summary="Atualizar país da usuária logada",
    description="Atualiza o país (ISO 3166-1 alpha-2) da usuária autenticada. "
    "Usado pra liberar pagamentos Pix na carteira (routers/carteira.py) — "
    "só faz sentido pra quem está no Brasil.",
)
def update_pais(
    payload: PaisUpdate,
    current_usuaria: Usuaria = Depends(get_current_usuaria),
    db: Session = Depends(get_db),
):
    current_usuaria.pais = payload.pais
    db.commit()
    db.refresh(current_usuaria)
    return current_usuaria


@router.get(
    "/me/convite",
    response_model=ConviteResponse,
    summary="Gerar link de convite (disponível apenas para nível 3+)",
    description="Retorna o código de indicação da usuária e o link de convite. "
    "Apenas usuárias em tier 3 ou superior podem gerar convites.",
)
def get_convite(
    current_usuaria: Usuaria = Depends(get_current_usuaria),
):
    if not pode_avalizar(current_usuaria):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Convites disponíveis apenas a partir do nível 3",
        )

    codigo = current_usuaria.codigo_indicacao
    link = f"/convite/{codigo}"
    return ConviteResponse(codigo=codigo, link=link)


@router.get(
    "/me/avalistas-recuperacao",
    response_model=AvalistasRecuperacaoListResponse,
    summary="Listar avalistas de recuperação da usuária logada",
    description="Retorna os slots de avalistas via Nostr (T=2, N=2: 1 convidadora "
    "+ 1 share no backend) da usuária autenticada. Cada slot tem um npub e um "
    "flag is_shadow. Usado pelo frontend para saber para quais npubs enviar "
    "pedidos NIP-17 de recuperação de shares SSSS. O share guardado pelo backend "
    "não aparece aqui — ele é acessado via /usuarias/me/recovery-share.",
)
def get_my_avalistas_recuperacao(
    current_usuaria: Usuaria = Depends(get_current_usuaria),
    db: Session = Depends(get_db),
):
    avalistas = (
        db.query(AvalistaRecuperacao)
        .filter(AvalistaRecuperacao.usuaria_id == current_usuaria.id)
        .order_by(AvalistaRecuperacao.ordem)
        .all()
    )
    return AvalistasRecuperacaoListResponse(
        avalistas=_build_avalistas_out(db, avalistas)
    )


@router.post(
    "/me/avalistas-recuperacao",
    response_model=AvalistaRecuperacaoOut,
    status_code=status.HTTP_201_CREATED,
    summary="Vincular tecelã de confiança (avalista de recuperação) após o cadastro",
    description="Permite que uma usuária que se cadastrou sem convidadora (ou cuja "
    "convidadora não tinha npub na época) vincule sua tecelã de confiança como "
    "avalista de recuperação DEPOIS do onboarding — atualizando do paper backup "
    "para a recuperação social via Nostr. O vínculo é feito via codigo_indicacao "
    "da mentora. Validações: a mentora existe, tem npub, não é a própria usuária "
    "e a usuária ainda não tem nenhum slot de avalista vinculado. Cria 1 slot "
    "(ordem=1, is_shadow=False) com o npub da mentora — mesmo padrão usado no "
    "cadastro via _create_recovery_shadows.",
)
def vincular_mentor_recuperacao(
    payload: VincularMentorIn,
    current_usuaria: Usuaria = Depends(get_current_usuaria),
    db: Session = Depends(get_db),
):
    # Rejeita se a usuária já tem algum slot de avalista de recuperação.
    existente = (
        db.query(AvalistaRecuperacao)
        .filter(AvalistaRecuperacao.usuaria_id == current_usuaria.id)
        .first()
    )
    if existente is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Você já tem uma tecelã de confiança vinculada.",
        )

    # Localiza a mentora pelo codigo_indicacao.
    mentora = (
        db.query(Usuaria)
        .filter(Usuaria.codigo_indicacao == payload.codigo_indicacao)
        .first()
    )
    if mentora is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Não encontramos essa tecelã. Confira o código.",
        )

    # A mentora não pode ser a própria usuária.
    if mentora.id == current_usuaria.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Você não pode vincular a si mesma como tecelã de confiança.",
        )

    # A mentora precisa ter npub para receber o share via Nostr (gift-wrap).
    if not mentora.npub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Essa tecelã ainda não tem npub cadastrado — não é possível "
            "vincular para recuperação via Nostr.",
        )

    # Cria o slot no mesmo padrão do _create_recovery_shadows (Option E).
    slot = AvalistaRecuperacao(
        usuaria_id=current_usuaria.id,
        npub_avaliadora=mentora.npub,
        ordem=1,
        is_shadow=False,
    )
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return _build_avalista_out(db, slot)


@router.get(
    "/by-identificador/{identificador}/npub",
    response_model=NpubPublicoResponse,
    summary="Descobrir npub público de uma usuária pelo identificador",
    description="Retorna o npub (chave pública Nostr) de uma usuária a partir do "
    "seu identificador. NÃO requer autenticação — npub é público por design "
    "(é uma chave pública). Usado por um novo dispositivo que sabe apenas o "
    "identificador da conta para descobrir o npub e iniciar a recuperação social.",
)
def get_npub_by_identificador(
    identificador: str,
    db: Session = Depends(get_db),
):
    usuaria = (
        db.query(Usuaria)
        .filter(Usuaria.identificador == identificador)
        .first()
    )
    if not usuaria:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuária não encontrada",
        )
    return NpubPublicoResponse(
        identificador=usuaria.identificador,
        npub=usuaria.npub,
    )


@router.get(
    "/by-identificador/{identificador}/avalistas-recuperacao",
    response_model=AvalistasRecuperacaoListResponse,
    summary="Descobrir avalistas de recuperação de uma usuária pelo identificador",
    description="Retorna a lista de avalistas de recuperação via Nostr (T=2, N=2: "
    "1 convidadora + 1 share no backend) de uma usuária a partir do seu "
    "identificador. NÃO requer autenticação — npub é público. Usado por um "
    "novo dispositivo que sabe apenas o identificador da conta para descobrir "
    "para quais npubs enviar pedidos NIP-17 de recuperação de shares SSSS. "
    "O share guardado pelo backend não aparece aqui.",
)
def get_avalistas_recuperacao_by_identificador(
    identificador: str,
    db: Session = Depends(get_db),
):
    usuaria = (
        db.query(Usuaria)
        .filter(Usuaria.identificador == identificador)
        .first()
    )
    if not usuaria:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuária não encontrada",
        )
    avalistas = (
        db.query(AvalistaRecuperacao)
        .filter(AvalistaRecuperacao.usuaria_id == usuaria.id)
        .order_by(AvalistaRecuperacao.ordem)
        .all()
    )
    return AvalistasRecuperacaoListResponse(
        avalistas=_build_avalistas_out(db, avalistas)
    )


# ── Backup do share SSSS criptografado com PIN (Option E) ─────

@router.post(
    "/me/recovery-share",
    response_model=RecoveryShareBackupOut,
    summary="Armazenar (ou substituir) o share SSSS criptografado com PIN",
    description="Armazena o share 1 de 2 (estratégia Option E, T=2 N=2) "
    "criptografado pelo frontend com uma chave derivada do PIN da usuária "
    "(AES-GCM). O backend recebe apenas o blob opaco em base64 — nunca vê o "
    "PIN, nunca descriptografa e nunca participa da cripto Nostr. Como T=2, "
    "o backend sozinho não consegue reconstruir o nsec. Se já existir um "
    "share para a usuária, o blob é substituído (upsert).",
)
def upsert_recovery_share(
    payload: RecoveryShareBackupIn,
    response: Response,
    current_usuaria: Usuaria = Depends(get_current_usuaria),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(RecoveryShareBackup)
        .filter(RecoveryShareBackup.usuaria_id == current_usuaria.id)
        .first()
    )

    if existing is None:
        backup = RecoveryShareBackup(
            usuaria_id=current_usuaria.id,
            encrypted_share_blob=payload.share_blob,
        )
        db.add(backup)
        db.commit()
        db.refresh(backup)
        response.status_code = status.HTTP_201_CREATED
        return backup

    existing.encrypted_share_blob = payload.share_blob
    db.commit()
    db.refresh(existing)
    return existing


@router.get(
    "/me/recovery-share",
    response_model=RecoveryShareBackupOut,
    summary="Buscar o share SSSS criptografado com PIN",
    description="Retorna o share 1 de 2 (estratégia Option E, T=2 N=2) "
    "criptografado com PIN, armazenado previamente via POST. O backend "
    "retorna o blob opaco em base64 sem interpretá-lo — o frontend é "
    "responsável por descriptografá-lo com a chave derivada do PIN. "
    "Retorna 404 se a usuária ainda não armazenou nenhum share.",
)
def get_recovery_share(
    current_usuaria: Usuaria = Depends(get_current_usuaria),
    db: Session = Depends(get_db),
):
    backup = (
        db.query(RecoveryShareBackup)
        .filter(RecoveryShareBackup.usuaria_id == current_usuaria.id)
        .first()
    )
    if backup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nenhum share de recuperação armazenado",
        )
    return backup
