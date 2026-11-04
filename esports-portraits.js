const TTL=7*24*60*60*1000;
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
export function permittedPortrait(p){
 if(!p||!/^https:\/\/(?:upload\.wikimedia\.org\/|commons\.wikimedia\.org\/wiki\/Special:FilePath\/)/i.test(p.url||'')||!/^https:\/\/commons\.wikimedia\.org\//i.test(p.source||''))return false;
 return /^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain)$/i.test(p.license||'')&&/^https:\/\/(creativecommons\.org|commons\.wikimedia\.org)\//i.test(p.licenseUrl||'')&&Boolean(p.author);
}
async function query(host,params){
 const u=new URL('/w/api.php',host);for(const [k,v] of Object.entries({...params,format:'json',origin:'*'}))u.searchParams.set(k,v);
 const r=await fetch(u,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Portrait indisponible');return r.json();
}
export async function fetchPlayerPortrait(player){
 if(permittedPortrait(player.photo))return player.photo;
 const key='runeterra-esports-photo-v1:'+player.wikipedia;
 try{const cache=JSON.parse(localStorage.getItem(key)||'null');if(cache&&Date.now()-cache.saved<(cache.photo?TTL:60*60*1000)&&(cache.photo===null||permittedPortrait(cache.photo)))return cache.photo;}catch{}
 let photo=null;
 try{
  const first=await query('https://en.wikipedia.org',{action:'query',prop:'pageimages|pageprops',piprop:'name',redirects:1,titles:player.wikipedia});
  const page=Object.values(first.query?.pages||{}).find(p=>p.pageid>0&&!Object.hasOwn(p.pageprops||{},'disambiguation')&&p.pageimage);
  if(!page)throw new Error('Pas de portrait identifié');
  const second=await query('https://commons.wikimedia.org',{action:'query',prop:'imageinfo',iiprop:'url|extmetadata|mime',iiurlwidth:500,titles:'File:'+page.pageimage});
  const info=Object.values(second.query?.pages||{}).find(p=>p.pageid>0)?.imageinfo?.[0],m=info?.extmetadata||{};
  if(!info||!/^image\/(jpeg|png|webp)$/.test(info.mime||'')||plain(m.Restrictions?.value))throw new Error('Portrait non retenu');
  const candidate={url:info.thumburl||info.url,source:info.descriptionurl,license:plain(m.LicenseShortName?.value),licenseUrl:plain(m.LicenseUrl?.value),author:plain(m.Artist?.value),credit:plain(m.Credit?.value),file:page.pageimage};
  if(permittedPortrait(candidate))photo=candidate;
 }catch{}
 try{localStorage.setItem(key,JSON.stringify({saved:Date.now(),photo}));}catch{}
 return photo;
}
