/** Mock data for the Comunidade screen — groups and feed posts.
 *
 *  These are purely decorative (no backend entity behind a "grupo" or
 *  "post" exists, same as the pattern catalog). The one real feature on
 *  this page is the invite button, which maps to the actual invite
 *  mechanism via GET /usuarias/me/convite.
 */

export interface Grupo {
  id: number;
  nome: string;
  membros: number;
  emoji: string;
}

export const grupos: Grupo[] = [
  { id: 1, nome: "Tricô do Bairro", membros: 24, emoji: "🧣" },
  { id: 2, nome: "Amigurumi Clube", membros: 58, emoji: "🧸" },
  { id: 3, nome: "Crochê para Iniciantes", membros: 112, emoji: "🌱" },
];

export interface Post {
  id: number;
  autora: string;
  texto: string;
  tempo: string;
  emoji: string;
}

export const posts: Post[] = [
  { id: 1, autora: "Joana T.", texto: "Terminei meu cachecol de trama dupla, ficou lindo!", tempo: "2h", emoji: "🧣" },
  { id: 2, autora: "Bea R.", texto: "Alguém tem dica pra não perder a contagem no ponto fantasia?", tempo: "5h", emoji: "🧶" },
  { id: 3, autora: "Marina L.", texto: "Comecei um amigurumi novo essa semana, depois posto o resultado!", tempo: "1d", emoji: "🧸" },
];
