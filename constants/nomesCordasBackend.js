// constants/nomesCordasBackend.js
export const nomesCordas = {
  // Mirim
  "amarela-mirim": "Amarela Claro",
  "azul-mirim": "Azul Claro",
  "verde-mirim": "Verde Claro",

  // Infantil
  "cru-infantil": "Cru",
  "cru-amarela-infantil": "Cru / Amarela",
  "cru-laranja-infantil": "Cru / Laranja",
  "cru-azul-infantil": "Cru / Azul",
  "cru-verde-infantil": "Cru / Verde",
  "cru-roxa-infantil": "Cru / Roxa",
  "cru-marrom-infantil": "Cru / Marrom",
  "cru-vermelha-infantil": "Cru / Vermelha",

  // Adulto
  "cru-adulto": "Cru",
  "cru-amarela-adulto": "Cru / Amarela",
  "amarela-adulto": "Amarela",
  "amarela-laranja-adulto": "Amarela / Laranja",
  "laranja-adulto": "Laranja",
  "laranja-azul-adulto": "Laranja / Azul (Graduado(a))",
  "azul-adulto": "Azul (Monitor(a))",
  "verde-adulto": "Verde (Instrutor(a))",
  "roxa-adulto": "Roxa (Professor(a))",
  "marrom-adulto": "Marrom (Contra-mestre(a))",

  // Estagiário
  "cru-e-preta-estagiario": "Cru / preta (Estagiário(a))",

  // Mestre
  "vermelha-mestre": "Vermelha (Mestre(a))",
};

export const gruposCordas = [
  { key: "mirim", label: "Mirim (2 a 5 anos)", match: (k) => k.endsWith("-mirim") },
  { key: "infantil", label: "Infantil (6 a 14 anos)", match: (k) => k.endsWith("-infantil") },
  { key: "adulto", label: "Adulto", match: (k) => k.endsWith("-adulto") },
  { key: "estagiario", label: "Estagiário", match: (k) => k.endsWith("-estagiario") },
  { key: "mestre", label: "Mestre", match: (k) => k === "vermelha-mestre" },
];

export const SUBCLASSES_CORDAS = {
  mirim: "Mirim",
  infantil: "Infantil",
  adulto: "Adulto",
  estagiario: "Estagiário",
  mestre: "Mestre",
};

export const PROXIMA_CORDA_MAP = {
  // Mirim
  "amarela-mirim": "azul-mirim",
  "azul-mirim": "verde-mirim",
  "verde-mirim": "cru-infantil",

  // Infantil
  "cru-infantil": "cru-amarela-infantil",
  "cru-amarela-infantil": "cru-laranja-infantil",
  "cru-laranja-infantil": "cru-azul-infantil",
  "cru-azul-infantil": "cru-verde-infantil",
  "cru-verde-infantil": "cru-roxa-infantil",
  "cru-roxa-infantil": "cru-marrom-infantil",
  "cru-marrom-infantil": "cru-vermelha-infantil",
  "cru-vermelha-infantil": "cru-adulto",

  // Adulto
  "cru-adulto": "cru-amarela-adulto",
  "cru-amarela-adulto": "amarela-adulto",
  "amarela-adulto": "amarela-laranja-adulto",
  "amarela-laranja-adulto": "laranja-adulto",
  "laranja-adulto": "laranja-azul-adulto",
  "laranja-azul-adulto": "azul-adulto",
  "azul-adulto": "verde-adulto",
  "verde-adulto": "roxa-adulto",
  "roxa-adulto": "marrom-adulto",
  "marrom-adulto": "cru-e-preta-estagiario",

  // Estagiário
  "cru-e-preta-estagiario": "vermelha-mestre",
  "vermelha-mestre": null,
};

export const getCordaNome = (slug) => nomesCordas[slug] || slug || "-";

export const getCordaSubclasse = (slug) => {
  if (!slug) return "";
  const g = gruposCordas.find((x) => x.match(slug));
  if (!g) return "";
  return SUBCLASSES_CORDAS[g.key] || g.key;
};

export const getCordaNomeComSubclasse = (slug) => {
  if (!slug || slug === "Sem Corda") return slug || "-";
  const nome = getCordaNome(slug);
  const subclasse = getCordaSubclasse(slug);
  if (!subclasse) return nome;
  return `${nome} - ${subclasse}`;
};

export const getProximaCorda = (slug) => {
  if (!slug) return null;
  return PROXIMA_CORDA_MAP[slug] || null;
};

export const getProximaCordaNomeComSubclasse = (slug) => {
  const prox = getProximaCorda(slug);
  if (!prox) return "-";
  return getCordaNomeComSubclasse(prox);
};
