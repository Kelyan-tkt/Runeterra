// Aucun tirage automatique tant que le taux n'a pas été validé.
// enabled=true active un bonus indépendant, sans remplacer les cinq cartes.
export const ASCENDED_CONFIG = Object.freeze({ enabled:false, chance:0.001 });
// video : fichier vidéo autorisé correspondant exactement à l'illustration.
// Sans vidéo, le rendu utilise les effets CSS et l'illustration existante.
export const ASCENDED_CATALOG = Object.freeze([
 {champion:'Ashe',theme:'ice',video:''},
 {champion:'Ahri',theme:'spirit',video:''},
 {champion:'Lux',theme:'light',video:''},
 {champion:'Thresh',theme:'mist',video:''},
 {champion:'AurelionSol',theme:'stars',video:''},
 {champion:'Jinx',theme:'spark',video:''},
 {champion:'Yasuo',theme:'wind',video:''},
 {champion:'Kaisa',theme:'void',video:''},
 {champion:'MissFortune',theme:'ember',video:''},
 {champion:'Leona',theme:'sun',video:''}
]);
