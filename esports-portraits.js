const TTL=7*24*60*60*1000;
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const norm=s=>plain(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function permittedPortrait(p){
 if(!p||!/^https:\/\/(?:upload\.wikimedia\.org\/|commons\.wikimedia\.org\/wiki\/Special:FilePath\/)/i.test(p.url||'')||!/^https:\/\/commons\.wikimedia\.org\//i.test(p.source||''))return false;
 if(p.local&&!/^\.\/assets\/esports\/[a-z0-9-]+\.(jpg|png|webp)$/.test(p.local))return false;
 return /^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain)$/i.test(p.license||'')&&/^https:\/\/(creativecommons\.org|commons\.wikimedia\.org)\//i.test(p.licenseUrl||'')&&Boolean(p.author);
}
async function query(host,params){
 const url=new URL('/w/api.php',host);for(const [k,v] of Object.entries({...params,format:'json',origin:'*',maxlag:5}))url.searchParams.set(k,v);
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Portrait : HTTP '+response.status);const data=await response.json();if(data.error)throw new Error('Portrait : '+(data.error.code||'erreur API'));return data;
}
export async function fetchPlayerPortrait(player,{refresh=false}={}){
 if(!refresh&&permittedPortrait(player.photo))return player.photo;
 const cacheKey='runeterra-pro-portrait-v3:'+(player.sourceId||player.wikipedia||player.id);
 if(!refresh)try{const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(cached&&Date.now()-cached.saved<(cached.photo?TTL:60*60*1000)&&(cached.photo===null||permittedPortrait(cached.photo)))return cached.photo;}catch{}
 let result=null;
 try{
  let qid=/^Q\d+$/.test(player.wikidata||'')?player.wikidata:'',filename='';
  if(player.wikipedia){
   const data=await query('https://en.wikipedia.org',{action:'query',prop:'pageimages|pageprops',piprop:'name',redirects:1,titles:player.wikipedia});
   const page=Object.values(data.query?.pages||{}).find(p=>p.pageid>0&&!Object.hasOwn(p.pageprops||{},'disambiguation'));
   if(page){qid=page.pageprops?.wikibase_item||qid;filename=page.pageimage||'';}
  }
  if(!qid&&!filename){
   const data=await query('https://www.wikidata.org',{action:'wbsearchentities',search:player.handle,language:'en',uselang:'en',type:'item',limit:10});
   const matches=(data.search||[]).filter(x=>/^Q\d+$/.test(x.id)&&/league of legends/i.test(x.description||'')&&[x.label,...(x.aliases||[])].some(alias=>norm(alias)===norm(player.handle)));
   if(matches.length===1)qid=matches[0].id;
  }
  const files=[];
  if(qid){const data=await query('https://www.wikidata.org',{action:'wbgetentities',ids:qid,props:'claims'});for(const claim of data.entities?.[qid]?.claims?.P18||[]){const value=claim.mainsnak?.datavalue?.value;if(typeof value==='string')files.push(value);}}
  if(filename)files.push(filename);
  for(const file of [...new Set(files)].slice(0,3)){
   const data=await query('https://commons.wikimedia.org',{action:'query',prop:'imageinfo',iiprop:'url|extmetadata|mime',iiurlwidth:500,titles:'File:'+file});
   const info=Object.values(data.query?.pages||{}).find(p=>p.pageid>0)?.imageinfo?.[0],m=info?.extmetadata||{};
   if(!info||!/^image\/(jpeg|png|webp)$/.test(info.mime||''))continue;
   // La licence du fichier ne dispense pas de respecter le droit à l'image.
   const restrictions=plain(m.Restrictions?.value);
   if(restrictions&&!/^personality rights$/i.test(restrictions))continue;
   const candidate={url:info.thumburl||info.url,source:info.descriptionurl,license:plain(m.LicenseShortName?.value),licenseUrl:plain(m.LicenseUrl?.value),author:plain(m.Artist?.value),credit:plain(m.Credit?.value),file,restrictions,wikidata:qid};
   if(permittedPortrait(candidate)){result=candidate;break;}
  }
 }catch{}
 try{localStorage.setItem(cacheKey,JSON.stringify({saved:Date.now(),photo:result}));}catch{}
 return result;
}
