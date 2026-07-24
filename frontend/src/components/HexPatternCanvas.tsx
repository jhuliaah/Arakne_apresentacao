/**
 * HexPatternCanvas — tela de desenho de padrão sobre grid hexagonal.
 *
 * Disfarce: parece um designer de padrão de crochê/bordado (teia de aranha
 * com fio dourado), mas é o mecanismo de acesso à camada financeira.
 * Substitui o PIN numérico e a frase de 18 palavras.
 *
 * UI pura — SEM criptografia. O parent recebe a sequência de vértices
 * via callback e faz a verificação (hash local + decrypt do nsec).
 *
 * Modos:
 * - "register": desenha → confirma repetindo → onPatternConfirmed(pattern)
 * - "login":    desenha → submete → onPatternSubmit(pattern)
 *
 * Mínimo de 8 vértices por padrão (requisito de entropia para KDF).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type HexPatternMode = "register" | "login";

export interface HexPatternCanvasProps {
  mode: HexPatternMode;
  /** Cadastro: chamado quando a usuária desenha e confirma (2x igual, ≥ minLength). */
  onPatternConfirmed?: (pattern: number[]) => void;
  /** Login: chamado quando a usuária submete um desenho. */
  onPatternSubmit?: (pattern: number[]) => void;
  /** Login: quando true, mostra feedback de erro (rastro treme e some). */
  error?: boolean;
  /** Mínimo de vértices (default 8 — requisito de entropia). */
  minLength?: number;
  /** Reset key — mudar este valor limpa o canvas (ex.: para forçar novo desenho). */
  resetKey?: number;
}

// ── Geometria do grid hexagonal ────────────────────────────────
// Hexágonos "pointy-top" (ponta para cima). Vertices são os 6 cantos
// de cada hexágono — pontos onde a usuária toca para conectar o fio.

const HEX_RADIUS = 26; // raio do hexágono (centro → vértice) em px
const VERTEX_HIT_RADIUS = 22; // raio de hit-test para toque no vértice
const GRID_COLS = 9;
const GRID_ROWS = 7;

interface Vertex {
  id: number;
  x: number;
  y: number;
}

interface Hexagon {
  cx: number;
  cy: number;
  vertexIds: number[]; // 6 vértices (ids)
}

// ── Cores (alinhadas ao design system do styles.css) ──────────
const COLOR_GRID = "rgba(107, 114, 128, 0.18)";
const COLOR_VERTEX_IDLE = "rgba(107, 114, 128, 0.25)";
const COLOR_VERTEX_ACTIVE = "#C9A227";
const COLOR_THREAD_LIGHT = "#E8C547";
const COLOR_THREAD_DARK = "#C9A227";
const COLOR_THREAD_GLOW = "rgba(201, 162, 39, 0.35)";
const COLOR_ERROR = "#c45c5c";

// ── Helpers de geometria ───────────────────────────────────────

/** Gera a malha hexagonal (hexágonos + vértices únicos). */
function buildHexGrid(width: number, height: number): {
  vertices: Vertex[];
  hexagons: Hexagon[];
} {
  const vertices: Vertex[] = [];
  const hexagons: Hexagon[] = [];
  const vertexMap = new Map<string, number>();

  const hexW = Math.sqrt(3) * HEX_RADIUS;
  const hexH = 2 * HEX_RADIUS;
  const horizSpacing = hexW;
  const vertSpacing = hexH * 0.75;

  const totalW = (GRID_COLS - 1) * horizSpacing + horizSpacing;
  const totalH = (GRID_ROWS - 1) * vertSpacing + hexH;
  const offsetX = (width - totalW) / 2 + horizSpacing / 2;
  const offsetY = (height - totalH) / 2 + HEX_RADIUS;

  const addVertex = (x: number, y: number): number => {
    const key = `${Math.round(x * 10)},${Math.round(y * 10)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const id = vertices.length;
    vertices.push({ id, x, y });
    vertexMap.set(key, id);
    return id;
  };

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cx = offsetX + col * horizSpacing + (row % 2 === 1 ? horizSpacing / 2 : 0);
      const cy = offsetY + row * vertSpacing;
      const vertexIds: number[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const vx = cx + HEX_RADIUS * Math.cos(angle);
        const vy = cy + HEX_RADIUS * Math.sin(angle);
        vertexIds.push(addVertex(vx, vy));
      }
      hexagons.push({ cx, cy, vertexIds });
    }
  }

  return { vertices, hexagons };
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function findVertexAt(vertices: Vertex[], x: number, y: number): Vertex | null {
  let closest: Vertex | null = null;
  let closestDist = VERTEX_HIT_RADIUS;
  for (const v of vertices) {
    const d = distance(v.x, v.y, x, y);
    if (d < closestDist) {
      closestDist = d;
      closest = v;
    }
  }
  return closest;
}

/** Desenha o grid + vértices + rastro. Função pura (sem estado React). */
function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vertices: Vertex[],
  hexagons: Hexagon[],
  pattern: number[],
  pointerPos: { x: number; y: number } | null,
  isDrawing: boolean,
  isErrored: boolean,
): void {
  ctx.clearRect(0, 0, width, height);

  // 1. Grid hexagonal (linhas sutis).
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const hex of hexagons) {
    const verts = hex.vertexIds.map((id) => vertices[id]);
    if (verts.length === 0) continue;
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
  }
  ctx.stroke();

  // 2. Vértices (pontos).
  const activeIds = new Set(pattern);
  for (const v of vertices) {
    ctx.beginPath();
    ctx.arc(v.x, v.y, activeIds.has(v.id) ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = activeIds.has(v.id) ? COLOR_VERTEX_ACTIVE : COLOR_VERTEX_IDLE;
    ctx.fill();
  }

  // 3. Rastro de fio dourado (gradiente + glow).
  if (pattern.length > 0) {
    const threadColor = isErrored ? COLOR_ERROR : COLOR_THREAD_DARK;
    const threadLight = isErrored ? "#e88080" : COLOR_THREAD_LIGHT;

    ctx.save();
    ctx.shadowColor = isErrored ? "rgba(196, 92, 92, 0.4)" : COLOR_THREAD_GLOW;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = threadColor;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const first = vertices[pattern[0]];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pattern.length; i++) {
      const v = vertices[pattern[i]];
      ctx.lineTo(v.x, v.y);
    }
    if (isDrawing && pointerPos) {
      ctx.lineTo(pointerPos.x, pointerPos.y);
    }
    ctx.stroke();
    ctx.restore();

    const lastV = vertices[pattern[pattern.length - 1]];
    const grad = ctx.createLinearGradient(
      first.x,
      first.y,
      pointerPos?.x ?? lastV.x,
      pointerPos?.y ?? lastV.y,
    );
    grad.addColorStop(0, threadLight);
    grad.addColorStop(1, threadColor);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pattern.length; i++) {
      const v = vertices[pattern[i]];
      ctx.lineTo(v.x, v.y);
    }
    if (isDrawing && pointerPos) {
      ctx.lineTo(pointerPos.x, pointerPos.y);
    }
    ctx.stroke();
  }
}

// ── Componente ─────────────────────────────────────────────────

export function HexPatternCanvas({
  mode,
  onPatternConfirmed,
  onPatternSubmit,
  error = false,
  minLength = 8,
  resetKey,
}: HexPatternCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const verticesRef = useRef<Vertex[]>([]);
  const hexagonsRef = useRef<Hexagon[]>([]);
  const drawingRef = useRef<boolean>(false);
  const patternRef = useRef<number[]>([]);
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const errorAnimRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const capturedPointerIdRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const [status, setStatus] = useState<
    "idle" | "drawing" | "confirming" | "mismatch" | "too-short" | "submitted"
  >("idle");
  const firstPatternRef = useRef<number[] | null>(null);

  // ── Render (desenha a cena atual no canvas) ──────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    drawScene(
      ctx,
      rect.width,
      rect.height,
      verticesRef.current,
      hexagonsRef.current,
      patternRef.current,
      pointerPosRef.current,
      drawingRef.current,
      errorAnimRef.current !== null,
    );
    rafRef.current = null;
  }, []);

  const scheduleRender = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(render);
    }
  }, [render]);

  // ── Setup do canvas + grid ───────────────────────────────────
  // IMPORTANTE: não definir canvas.style.width/height no JS.
  // O CSS controla o tamanho (aspect-ratio: 1/1; width: 100%).
  // Definir style.width/height aqui causa loop infinito do ResizeObserver
  // (muda layout → observer dispara de novo → trava o navegador inteiro).
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const setupCanvas = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      // Só define o buffer interno (pixels físicos), NÃO o style (layout).
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const { vertices, hexagons } = buildHexGrid(rect.width, rect.height);
      verticesRef.current = vertices;
      hexagonsRef.current = hexagons;
      scheduleRender();
    };

    setupCanvas();
    const ro = new ResizeObserver(() => {
      // Guarda o tamanho para evitar re-disparar se não mudou.
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w === lastSizeRef.current.w && h === lastSizeRef.current.h) return;
      lastSizeRef.current = { w, h };
      setupCanvas();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [scheduleRender]);

  // ── Reset quando resetKey muda ──────────────────────────────
  useEffect(() => {
    patternRef.current = [];
    pointerPosRef.current = null;
    setStatus("idle");
    firstPatternRef.current = null;
    scheduleRender();
  }, [resetKey, scheduleRender]);

  // ── Cleanup no unmount: libera pointer capture + cancela RAF ─
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (errorAnimRef.current !== null) {
        clearTimeout(errorAnimRef.current);
        errorAnimRef.current = null;
      }
      // Libera pointer capture se o componente desmontar durante o desenho.
      const canvas = canvasRef.current;
      const pid = capturedPointerIdRef.current;
      if (canvas && pid !== null) {
        try {
          canvas.releasePointerCapture(pid);
        } catch {
          // ignore — pointer já foi liberado
        }
        capturedPointerIdRef.current = null;
      }
    };
  }, []);

  // ── Erro: anima tremor e limpa ───────────────────────────────
  useEffect(() => {
    if (!error) return;
    errorAnimRef.current = window.setTimeout(() => {
      patternRef.current = [];
      pointerPosRef.current = null;
      drawingRef.current = false;
      errorAnimRef.current = null;
      setStatus("idle");
      scheduleRender();
    }, 600);
    scheduleRender();
    return () => {
      if (errorAnimRef.current !== null) {
        clearTimeout(errorAnimRef.current);
        errorAnimRef.current = null;
      }
    };
  }, [error, scheduleRender]);

  // ── Pointer handlers (touch + mouse) ────────────────────────
  const getPointerPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const releasePointerCapture = () => {
    const canvas = canvasRef.current;
    const pid = capturedPointerIdRef.current;
    if (canvas && pid !== null) {
      try {
        canvas.releasePointerCapture(pid);
      } catch {
        // ignore
      }
      capturedPointerIdRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // Bloqueia novo desenho apenas quando já submeteu (sucesso ou login).
    // "confirming" DEVE permitir novo desenho — é o segundo passo do registro.
    if (status === "submitted") return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (canvas && e.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(e.pointerId);
        capturedPointerIdRef.current = e.pointerId;
      } catch {
        // ignore — alguns browsers falham se o pointer já foi capturado
      }
    }
    drawingRef.current = true;
    const pos = getPointerPos(e);
    if (!pos) return;
    pointerPosRef.current = pos;
    const v = findVertexAt(verticesRef.current, pos.x, pos.y);
    if (v && !patternRef.current.includes(v.id)) {
      patternRef.current = [v.id];
      setStatus("drawing");
    }
    scheduleRender();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    if (!pos) return;
    pointerPosRef.current = pos;
    const v = findVertexAt(verticesRef.current, pos.x, pos.y);
    if (v && !patternRef.current.includes(v.id)) {
      patternRef.current = [...patternRef.current, v.id];
    }
    scheduleRender();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
    pointerPosRef.current = null;
    releasePointerCapture();
    const pattern = [...patternRef.current];

    if (pattern.length === 0) {
      setStatus("idle");
      scheduleRender();
      return;
    }

    if (mode === "login") {
      setStatus("submitted");
      onPatternSubmit?.(pattern);
      scheduleRender();
      return;
    }

    if (pattern.length < minLength) {
      setStatus("too-short");
      patternRef.current = [];
      scheduleRender();
      setTimeout(() => {
        setStatus("idle");
        scheduleRender();
      }, 1500);
      return;
    }

    if (firstPatternRef.current === null) {
      firstPatternRef.current = pattern;
      patternRef.current = [];
      setStatus("confirming");
      scheduleRender();
      return;
    }

    const first = firstPatternRef.current;
    const matches =
      first.length === pattern.length &&
      first.every((id, i) => id === pattern[i]);

    if (matches) {
      setStatus("submitted");
      onPatternConfirmed?.(pattern);
      scheduleRender();
    } else {
      setStatus("mismatch");
      firstPatternRef.current = null;
      patternRef.current = [];
      scheduleRender();
      setTimeout(() => {
        setStatus("idle");
        scheduleRender();
      }, 1500);
    }
  };

  const handlePointerCancel = () => {
    drawingRef.current = false;
    pointerPosRef.current = null;
    releasePointerCapture();
    scheduleRender();
  };

  // ── Mensagens de status ─────────────────────────────────────
  const message = (() => {
    switch (status) {
      case "drawing":
        return mode === "register"
          ? "Desenhe seu ponto Arakne"
          : "Desenhe seu ponto para continuar";
      case "confirming":
        return "Desenhe novamente para confirmar";
      case "mismatch":
        return "Esse desenho não bateu, tenta de novo";
      case "too-short":
        return `Use pelo menos ${minLength} pontos no desenho`;
      case "submitted":
        return mode === "register" ? "Ponto registrado!" : "Verificando...";
      default:
        return mode === "register"
          ? "Desenhe seu ponto Arakne"
          : "Desenhe seu ponto para continuar";
    }
  })();

  const isErrorState = status === "mismatch" || status === "too-short" || error;

  return (
    <div className="hex-pattern" ref={containerRef}>
      <p
        className={`hex-pattern__message${isErrorState ? " hex-pattern__message--error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      <canvas
        ref={canvasRef}
        className="hex-pattern__canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        style={{ touchAction: "none" }}
        aria-label="Tela de desenho do ponto Arakne"
      />
    </div>
  );
}

export default HexPatternCanvas;
