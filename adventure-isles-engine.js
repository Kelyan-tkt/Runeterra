// Chapitre expérimental : règles originales adaptées à l'univers de LoL.
export const RELICS = [
 {id:'zhonya',name:'Sablier de Zhonya',text:'La première Protection de chaque combat annule les dégâts du tour.'},
 {id:'guardian',name:'Ange gardien',text:'Une seule fois par expédition : évite une défaite et rend 25 % des PV.'},
 {id:'warmog',name:'Armure de Warmog',text:'Après chaque victoire, récupère 7 % des PV maximum.'},
 {id:'blade',name:'Lame du roi déchu',text:'Les attaques rendent des PV égaux à 5 % des dégâts infligés.'},
 {id:'redemption',name:'Rédemption',text:'Les deux soins disponibles dans chaque combat sont renforcés de 50 %.'},
 {id:'banshee',name:'Voile de la banshee',text:'Annule le premier poison de Kalista ou vol de vie de Thresh à chaque combat.'}
];
export const ENEMIES = {
 Maokai:{name:'Maokai',hp:1900,armor:45,mr:45,attack:135,heavy:420,type:'magic',text:'Maokai récupère 40 PV après ses tours normaux. Frappe lourde tous les trois tours.'},
 Kalista:{name:'Kalista',hp:2450,armor:45,mr:40,attack:170,heavy:560,type:'physical',text:'Ses tours normaux ajoutent 35 dégâts de poison. Victoire : 120 pièces d’expédition.'},
 Hecarim:{name:'Hecarim',hp:2800,armor:60,mr:45,attack:190,heavy:850,type:'physical',text:'Sa charge est plus dangereuse, mais la victoire rapporte 240 pièces d’expédition.'},
 Thresh:{name:'Thresh',hp:3900,armor:65,mr:65,attack:210,heavy:700,type:'magic',text:'Après une frappe lourde non protégée, Thresh vole 150 PV. C’est le dernier combat du chapitre.'}
};
const copy=x=>JSON.parse(JSON.stringify(x));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const has=(r,id)=>r.relics.includes(id);
const heal=(r,n)=>{const before=r.hp;r.hp=Math.min(r.maxHP,r.hp+Math.round(n));return r.hp-before;};
const note=(r,text)=>{r.log.unshift(text);r.log=r.log.slice(0,12);};
const hash=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
export function emptyProgress(){return {version:1,revision:0,records:{wins:0,bestTurns:0},run:null};}
export function intent(b){return b.turn%3===2?'warning':b.turn%3===0?'exposed':'normal';}
function offer(r,next){
 const available=RELICS.filter(x=>!has(r,x.id));
 available.sort((a,b)=>hash(`${r.id}:${r.offers}:${a.id}`)-hash(`${r.id}:${r.offers}:${b.id}`));
 r.offers++;r.choices=available.slice(0,3).map(x=>x.id);r.next=next;r.stage='relic';
}
function encounter(r,id){r.stage='battle';r.battle={id,hp:ENEMIES[id].hp,turn:1,cd:0,heals:2,zhonyaUsed:false,bansheeUsed:false};note(r,`${id} vous affronte.`);}
function hurt(r,n){
 r.hp=Math.max(0,r.hp-Math.max(0,Math.round(n)));
 if(r.hp===0&&has(r,'guardian')&&!r.guardianUsed){r.guardianUsed=true;r.hp=Math.round(r.maxHP*.25);note(r,'Ange gardien : votre groupe revient avec 25 % de ses PV.');}
 if(r.hp===0){r.stage='lost';note(r,'Le groupe est vaincu. Vous pouvez recommencer sans perdre de cartes ni d’or de la campagne.');}
}
function win(progress,r){
 const id=r.battle.id;r.cleared.push(id);r.battle=null;
 if(has(r,'warmog'))note(r,`Armure de Warmog : +${heal(r,r.maxHP*.07)} PV.`);
 if(id==='Maokai'){r.stage='crossroads';note(r,'Maokai s’écarte. Deux routes traversent la Brume.');}
 else if(id==='Kalista'||id==='Hecarim'){r.coins+=id==='Kalista'?120:240;r.stage='event';note(r,`${id} vaincu : les pièces gagnées restent dans cette expédition.`);}
 else {r.stage='won';progress.records.wins++;const best=progress.records.bestTurns;progress.records.bestTurns=best?Math.min(best,r.totalTurns):r.totalTurns;note(r,'Thresh vaincu ! Le chapitre des Îles obscures est terminé. Aucun fragment ni booster n’est attribué dans cette version.');}
}
function combat(progress,r,action){
 const b=r.battle,e=ENEMIES[b.id],phase=intent(b);
 assert(['attack','burst','guard','heal'].includes(action),'Action inconnue.');
 assert(action!=='burst'||b.cd===0,'Assaut est encore en recharge.');
 assert(action!=='heal'||(b.heals>0&&r.hp<r.maxHP),'Aucun soin disponible ou PV déjà pleins.');
 let dealt=0;
 if(action==='heal') {b.heals--;note(r,`Ralliement : +${heal(r,r.maxHP*.16*(has(r,'redemption')?1.5:1))} PV.`);}
 else {
  const strength=action==='burst'?1.8:action==='guard'?.35:1;
  const base=r.stats.physical*100/(100+e.armor)+r.stats.magic*100/(100+e.mr);
  dealt=Math.min(b.hp,Math.max(1,Math.round(base*strength*(phase==='exposed'?1.6:1))));b.hp-=dealt;
  note(r,`${action==='burst'?'Assaut':action==='guard'?'Protection et riposte':'Attaque'} : ${dealt} dégâts.`);
  if(has(r,'blade'))heal(r,dealt*.05);
 }
 b.cd=Math.max(0,b.cd-1);if(action==='burst')b.cd=3;r.totalTurns++;
 if(b.hp===0){win(progress,r);return;}
 const guarding=action==='guard';let protection=guarding?.2:1;
 if(guarding&&has(r,'zhonya')&&!b.zhonyaUsed){b.zhonyaUsed=true;protection=0;note(r,'Sablier de Zhonya : aucun dégât ce tour.');}
 const resistance=e.type==='physical'?r.stats.armor:r.stats.mr;
 const hit=Math.round((phase==='warning'?e.heavy:e.attack*(phase==='exposed'?.5:1))*100/(100+resistance)*protection);
 hurt(r,hit);note(r,`${e.name} : ${hit} dégâts${phase==='warning'?' de frappe lourde':''}.`);
 if(r.stage==='lost')return;
 const poison=b.id==='Kalista'&&phase==='normal';
 const drain=b.id==='Thresh'&&phase==='warning'&&!guarding;
 if(poison||drain){
  if(has(r,'banshee')&&!b.bansheeUsed){b.bansheeUsed=true;note(r,'Voile de la banshee : effet secondaire annulé.');}
  else {const n=protection===0?0:poison?35:150;hurt(r,n);if(drain)b.hp=Math.min(e.hp,b.hp+n);note(r,`${poison?'Poison de Kalista':'Vol de vie de Thresh'} : ${n} PV.`);}
 }
 if(r.stage==='lost')return;
 if(b.id==='Maokai'&&phase==='normal')b.hp=Math.min(e.hp,b.hp+40);
 b.turn++;if(b.turn>80){r.stage='lost';note(r,'La Brume vous submerge après 80 tours. Recommencez avec une équipe mieux équipée.');}
}
export function transition(previous,command,ctx){
 const p=copy(previous||emptyProgress());
 assert(p.version===1,'Version de sauvegarde non prise en charge.');
 assert(ctx&&ctx.uid,'Connecte-toi pour jouer.');
 p.records ||= {wins:0,bestTurns:0};let r=p.run;
 if(command.type==='start'){
  assert(!r||['won','lost','abandoned'].includes(r.stage),'Termine ou abandonne l’expédition en cours.');
  assert(ctx.unlocked,'Termine les quatre rencontres des Îles obscures dans la campagne.');
  assert(ctx.team?.length===3,'Enregistre trois cartes dans Équipe & boutique.');
  assert(new Set(ctx.team.map(x=>Math.floor(x.id/1000))).size===3,'Choisis trois champions différents.');
  const units=copy(ctx.team);
  for(const u of units)for(const key of ['hp','ad','ap','armor','mr','as'])assert(Number.isFinite(u[key])&&u[key]>=0,'Statistiques d’équipe invalides.');
  const maxHP=Math.max(1,Math.round(units.reduce((n,u)=>n+u.hp,0)));
  r={id:String(command.id),stage:'relic',team:units,maxHP,hp:maxHP,stats:{
   physical:Math.round(units.reduce((n,u)=>n+(u.magic?u.ad*.4:u.ad)*u.as*1.8,0)),
   magic:Math.round(units.reduce((n,u)=>n+(u.magic?u.ap*.9:0)*u.as*1.8,0)),
   armor:Math.round(units.reduce((n,u)=>n+u.armor,0)/3),mr:Math.round(units.reduce((n,u)=>n+u.mr,0)/3)
  },coins:0,relics:[],choices:[],offers:0,next:'',guardianUsed:false,cleared:[],totalTurns:0,battle:null,log:['L’expédition commence. Les objets et statistiques de votre équipe sont figés pour ce parcours.']};
  p.run=r;offer(r,'Maokai');
 }else{
  assert(r&&!['won','lost','abandoned'].includes(r.stage),'Aucune expédition active.');
  if(command.type==='abandon'){r.stage='abandoned';r.battle=null;note(r,'Expédition abandonnée. Aucun objet, carte ou or de la campagne n’a été perdu.');}
  else{
   assert(r.team.every(u=>ctx.owned.includes(u.id)),'Une carte de l’expédition n’est plus possédée. Récupère-la ou abandonne le parcours.');
   if(command.type==='relic'){
    assert(r.stage==='relic'&&r.choices.includes(command.id),'Cette relique n’est pas proposée.');
    assert(r.relics.length<3&&!has(r,command.id),'Trois reliques différentes maximum.');
    r.relics.push(command.id);r.choices=[];note(r,`Relique obtenue : ${RELICS.find(x=>x.id===command.id).name}.`);
    const next=r.next;r.next='';if(next==='Maokai')encounter(r,'Maokai');else r.stage=next;
   }else if(command.type==='route'){
    assert(r.stage==='crossroads'&&['Kalista','Hecarim'].includes(command.id),'Route indisponible.');encounter(r,command.id);
   }else if(command.type==='event'){
    assert(r.stage==='event'&&['rescue','risk'].includes(command.id),'Événement indisponible.');
    if(command.id==='rescue')note(r,`Vous libérez des âmes avec Senna : +${heal(r,r.maxHP*.18)} PV.`);
    else{hurt(r,Math.ceil(r.maxHP*.12));r.coins+=140;note(r,'Traversée de la Brume : perte de 12 % des PV maximum et gain de 140 pièces d’expédition.');}
    if(r.stage!=='lost')r.stage='camp';
   }else if(command.type==='camp'){
    assert(r.stage==='camp','Le camp n’est pas accessible.');
    if(command.id==='heal'){assert(r.coins>=100&&r.hp<r.maxHP,'Soin indisponible.');r.coins-=100;note(r,`Repos au camp : +${heal(r,r.maxHP*.25)} PV.`);}
    else if(command.id==='relic'){assert(r.coins>=150&&r.relics.length<3,'Achat de relique indisponible.');r.coins-=150;offer(r,'camp');}
    else if(command.id==='boss')encounter(r,'Thresh');else throw new Error('Choix inconnu.');
   }else if(command.type==='combat'){assert(r.stage==='battle'&&r.battle,'Aucun combat actif.');combat(p,r,command.id);}
   else throw new Error('Commande inconnue.');
  }
 }
 p.revision=(p.revision||0)+1;return p;
}
