/** Mock crochet/texile patterns for the Arakne catalog. */

import type { Pattern } from "../types";

export const patterns: Pattern[] = [
  {
    id: 1,
    nome: "Ponto Corrente",
    nivel: "Iniciante",
    cor: "#e8b4b8",
    emoji: "🧶",
    descricao: "A base de todo crochê — laçadas em sequência que formam a corrente inicial.",
  },
  {
    id: 2,
    nome: "Ponto Baixo",
    nivel: "Iniciante",
    cor: "#b8d8e8",
    emoji: "🪡",
    descricao: "Ponto compacto e firme, ideal para bordas e peças estruturadas.",
  },
  {
    id: 3,
    nome: "Ponto Alto",
    nivel: "Intermediário",
    cor: "#d4e8b8",
    emoji: "🌿",
    descricao: "Ponto alto e arejado, cria textura leve para mantas e cachecóis.",
  },
  {
    id: 4,
    nome: "Ponto Baixíssimo",
    nivel: "Iniciante",
    cor: "#e8d4b8",
    emoji: "🍃",
    descricao: "O menor dos pontos — usado para deslocar o trabalho sem altura extra.",
  },
  {
    id: 5,
    nome: "Ponto Fantasia",
    nivel: "Avançado",
    cor: "#d4b8e8",
    emoji: "✨",
    descricao: "Combinação de laçadas e pontos altos que cria um efeito de concha delicado.",
  },
  {
    id: 6,
    nome: "Ponto Arakne",
    nivel: "Especial",
    cor: "#7c5e3c",
    emoji: "🕸️",
    descricao: "Padrão especial da comunidade — disponível apenas para membros ativos.",
  },
];

/** Second secret term — reveals a decoy catalog with zero financial traces.
 *  Someone snooping for "hidden" screens finds this instead of the real one.
 *
 *  O gesto "Ponto Arakne" foi removido: a camada financeira agora é
 *  revelada pela aula 1 do nível 1 da trilha #9 (desenho do Ponto Arakne). */
export const DECOY_SEARCH = "Galeria de Padrões";
