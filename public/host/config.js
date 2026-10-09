// Tudo que é balanceamento/visual configurável fica aqui (admin sobrescreve parte em runtime).
export const CFG = {
  matchSeconds: 120,
  capyCount: 90,
  // pontuação
  baseScore: 100,
  fastBonus: 50,       // captura rápida
  fastWindow: 2.5,     // s desde que entrou no raio
  comboWindow: 4.5,    // s entre capturas para manter o combo
  comboStep: 25,       // bônus por nível de combo
  goldenChance: 0.08,
  goldenMult: 3,
  // OVNI
  ufoAlt: 15,
  ufoSpeed: 40,
  beamSlow: 0.62,
  turboMult: 1.75,
  turboTime: 1.1,
  turboCooldown: 4.5,
  beamRadius: 4.6,     // raio no chão
  halfX: 385,          // limite do mapa (m) — campus FEOB
  halfZ: 222,
  maxPlayers: 4,
  resultSeconds: 7,
};

export const QUALITY = {
  LOW:    { pr: 0.75, shadow: 0,    bloom: false, msaa: 0, grass: 0.3, particles: 0.45, far: 0.6, trees: 0.6 },
  MEDIUM: { pr: 0.9, shadow: 1024, bloom: true,  msaa: 0, grass: 0.65, particles: 0.75, far: 0.85, trees: 0.85 },
  HIGH:   { pr: 1.25, shadow: 2048, bloom: true,  msaa: 2, grass: 1,    particles: 1,    far: 1, trees: 1 },
};

// personalização (índices iguais aos do controle mobile — OPT/MAX em public/join/index.html e validCfg em server/index.js)
// m modelo · c cor do casco · s estampa · l luz · b cor do raio · e efeito · a acessório · p piloto
export const UFO_COLORS = [0x2f6bff, 0x8a3dff, 0x22c55e, 0xef3b3b, 0xffc82e, 0xf1f3f8, 0xff7a1a, 0xff4fa3, 0x14c8d8, 0x1f2430, 0x9be22b, 0xb8892f];
export const LIGHT_COLORS = [0x3aa0ff, 0x2ef2ff, 0xc04dff, 0x5dff7a, 0xff5a5a, 0xffc82e, 0xff7ad0, 0xffffff];
export const BEAM_COLORS = [null, 0x5dff7a, 0xff7ad0, 0xffc82e, 0xff5a5a]; // null = cor da luz; índice 5 = arco-íris
export const MAX_CFG = { m: 4, c: 11, s: 3, l: 7, b: 5, e: 5, a: 7, p: 3 };
export const DEFAULT_PLAYER_CFG = { m: 0, c: 0, s: 0, l: 1, b: 0, e: 0, a: 0, p: 0 };
