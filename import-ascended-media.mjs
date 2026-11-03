// Node.js 20+ : node import-ascended-media.mjs
// Télécharge les médias publiquement accessibles. Ne contourne pas un refus du wiki.
import { mkdir,readFile,writeFile,rename,stat,open } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const ROOT=dirname(fileURLToPath(import.meta.url));
const CATEGORY='https://wiki.leagueoflegends.com/en-us/Category:Animated_champion_skins';
const OUTPUT=join(ROOT,'ascended-media.json');
const METADATA_ONLY=process.argv.includes('--metadata-only');
const HEADERS={'User-Agent':'RuneterraFanSite-MediaImporter/2.0 (noncommercial; sequential metadata, two download workers)','Accept':'application/json,text/html,video/*;q=0.9,*/*;q=0.5'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
async function request(url){
 for(let i=0;i<3;i++){
  const r=await fetch(url,{headers:HEADERS,signal:AbortSignal.timeout(90000),redirect:'follow'});
  if((r.status===429||r.status>=500)&&i<2){await r.body?.cancel();await wait(2000*(i+1));continue;}
  if(!r.ok)throw new Error(`HTTP ${r.status} : ${url}`);return r;
 }
}
async function apiCatalogue(endpoint){
 const records=[];let continuation={},count=0;
 do{
  const u=new URL(endpoint);const params={action:'query',format:'json',formatversion:'2',generator:'categorymembers',gcmtitle:'Category:Animated champion skins',gcmtype:'file',gcmlimit:'50',prop:'imageinfo',iiprop:'url|mime|size|extmetadata',maxlag:'5',...continuation};
  for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
  const response=await request(u);const data=JSON.parse(await response.text());
  if(data.error)throw new Error(data.error.info||data.error.code);
  const pages=Array.isArray(data.query?.pages)?data.query.pages:Object.values(data.query?.pages||{});
  for(const page of pages){const info=page.imageinfo?.[0],file=String(page.title||'').replace(/^File:/,'');if(!info?.url||! /\.(webm|mp4)$/i.test(file))continue;
   records.push({file,url:info.url,page:info.descriptionurl||`https://wiki.leagueoflegends.com/en-us/File:${encodeURIComponent(file.replaceAll(' ','_'))}`,mime:info.mime||'',bytes:info.size||0,local:'',attribution:{artist:info.extmetadata?.Artist?.value||'',credit:info.extmetadata?.Credit?.value||'',license:info.extmetadata?.LicenseShortName?.value||''}});
  }
  continuation=data.continue||null;if(++count>20)throw new Error('Pagination anormalement longue.');if(continuation)await wait(500);
 }while(continuation);
 if(!records.length)throw new Error('Aucun média vidéo retourné.');return records;
}
async function htmlCatalogue(){
 const files=new Map(),seen=new Set();let url=CATEGORY;
 while(url&&!seen.has(url)&&seen.size<12){
  seen.add(url);const html=await(await request(url)).text();
  for(const match of html.matchAll(/href=["']([^"']*\/File:[^"']+)["']/gi)){
   const page=new URL(decode(match[1]),CATEGORY).href;const file=decodeURIComponent(new URL(page).pathname.split('/File:')[1]||'').replaceAll('_',' ');
   if(/\.(webm|mp4)$/i.test(file))files.set(file,page);
  }
  const next=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(m=>/next page/i.test(m[2].replace(/<[^>]*>/g,''))&&/filefrom=/.test(m[1]));
  url=next?new URL(decode(next[1]),CATEGORY).href:null;if(url)await wait(600);
 }
 const records=[];
 for(const [file,page] of files){
  const html=await(await request(page)).text();
  const links=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map(m=>new URL(decode(m[1]),page).href);
  const url=links.find(x=>/\.(webm|mp4)(?:[?#]|$)/i.test(x)&&!x.includes('/File:')&&!x.includes('Special:'));
  if(url)records.push({file,page,url,local:''});await wait(300);
 }
 if(!records.length)throw new Error('Aucun fichier vidéo lisible dans le HTML du wiki.');return records;
}
async function catalogue(){
 const endpoints=['https://wiki.leagueoflegends.com/en-us/api.php','https://wiki.leagueoflegends.com/api.php','https://wiki.leagueoflegends.com/en-us/w/api.php'];
 try{const html=await(await request(CATEGORY)).text();for(const m of html.matchAll(/(?:href|content)=["']([^"']*api\.php[^"']*)["']/gi)){const u=new URL(decode(m[1]),CATEGORY);u.search='';if(u.hostname==='wiki.leagueoflegends.com')endpoints.unshift(u.href);}}catch(e){console.warn('Page de catégorie :',e.message);}
 for(const endpoint of [...new Set(endpoints)]){try{return await apiCatalogue(endpoint);}catch(e){console.warn('API indisponible :',endpoint,e.message);}}
 return htmlCatalogue();
}
async function looksLikeVideo(path){
 let fd;try{fd=await open(path,'r');const b=Buffer.alloc(16);await fd.read(b,0,16,0);return b.subarray(0,4).toString('hex')==='1a45dfa3'||b.subarray(4,8).toString()==='ftyp';}catch{return false;}finally{await fd?.close();}
}
async function saveManifest(records){
 const data={version:2,category:CATEGORY,fetchedAt:new Date().toISOString(),note:'Médias du LoL Wiki ; les droits de Riot et les éventuels crédits restent applicables. Les fichiers ne correspondent pas tous à des skins distincts.',records};
 const tmp=OUTPUT+'.part';await writeFile(tmp,JSON.stringify(data,null,2),'utf8');await rename(tmp,OUTPUT);
}
async function main(){
 console.log('Lecture de la catégorie complète et de ses pages suivantes…');
 const records=await catalogue();let previous={records:[]};try{previous=JSON.parse(await readFile(OUTPUT,'utf8'));}catch{}
 const old=new Map((previous.records||[]).map(r=>[r.file,r]));
 const full=new Map((previous.records||[]).map(r=>[r.file,r]));for(const r of records)full.set(r.file,{...old.get(r.file),...r});
 const all=[...full.values()];let downloaded=0,errors=0,bytes=0;
 if(METADATA_ONLY){await saveManifest(all);console.log(`${records.length} médias listés ; aucun téléchargement demandé.`);return;}
 await mkdir(join(ROOT,'assets','ascended'),{recursive:true});
 console.log(`${records.length} médias trouvés. Le téléchargement complet peut représenter plusieurs centaines de Mo.`);
 let cursor=0;
 async function worker(){
  while(cursor<records.length){const index=cursor++,record=records[index];
   try{
    const ext=/\.mp4$/i.test(record.file)?'.mp4':'.webm',name=createHash('sha256').update(record.file).digest('hex').slice(0,20)+ext;
    const relative='./assets/ascended/'+name,path=join(ROOT,'assets','ascended',name);
    if(!(await looksLikeVideo(path))){const response=await request(record.url);const length=Number(response.headers.get('content-length')||0);if(length>50*1024*1024)throw new Error('Fichier supérieur à 50 Mo.');
     const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>50*1024*1024)throw new Error('Fichier supérieur à 50 Mo.');
     const valid=buffer.subarray(0,4).toString('hex')==='1a45dfa3'||buffer.subarray(4,8).toString()==='ftyp';if(!valid)throw new Error('La réponse n’est pas un fichier WebM/MP4.');
     await writeFile(path+'.part',buffer);await rename(path+'.part',path);bytes+=buffer.length;downloaded++;
    }
    full.set(record.file,{...record,local:relative});console.log(`[${index+1}/${records.length}] OK ${record.file}`);
   }catch(e){errors++;console.error(`Échec ${record.file} : ${e.message}`);const oldRecord=old.get(record.file);full.set(record.file,{...record,local:oldRecord?.local||''});}
   await wait(400);
  }
 }
 await Promise.all([worker(),worker()]);await saveManifest([...full.values()]);
 console.log(`Catalogue écrit. ${downloaded} nouveaux fichiers, ${(bytes/1024/1024).toFixed(1)} Mo, ${errors} échecs. Publier aussi le dossier assets/ascended et ascended-media.json.`);
 if(errors)process.exitCode=1;
}
main().catch(error=>{console.error('Import interrompu :',error.message,'Le catalogue existant est conservé. Aucun contournement du wiki ne sera tenté.');process.exitCode=1;});
