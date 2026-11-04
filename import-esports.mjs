import fs from 'node:fs/promises';
const file=new URL('./esports-catalog.json',import.meta.url);
const data=JSON.parse(await fs.readFile(file,'utf8'));
const categories=[['Top','League of Legends top lane players'],['Jungle','League of Legends jungle players'],['Mid','League of Legends mid lane players'],['ADC','League of Legends AD Carry players'],['Support','League of Legends support players']];
const plain=s=>String(s).replace(/\s*\([^)]*\)\s*$/,'').trim();
const norm=s=>plain(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const players=new Map(data.players.map(p=>[p.id,p]));let added=0;
for(const [role,category] of categories){
 let more={};
 do{
  const url=new URL('https://en.wikipedia.org/w/api.php');
  const params={action:'query',list:'categorymembers',cmtitle:'Category:'+category,cmnamespace:0,cmlimit:500,format:'json',...more};
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  const response=await fetch(url,{headers:{'User-Agent':'RuneterraFanCatalogue/1.0 (non-commercial catalogue import)'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Wikipedia HTTP '+response.status+' : aucun catalogue sauvegardé.');
  const result=await response.json();if(result.error||!result.query?.categorymembers)throw new Error('Réponse Wikipedia invalide : aucun catalogue sauvegardé.');
  for(const entry of result.query.categorymembers){
   const existing=[...players.values()].find(p=>norm(p.wikipedia)===norm(entry.title)||norm(p.handle)===norm(entry.title));
   if(existing){existing.roles=[...new Set([...(existing.roles||[]),role])];}
   else{const id='wp-'+entry.pageid;players.set(id,{id,handle:plain(entry.title),roles:[role],wikipedia:entry.title});added++;}
  }
  more=result.continue||null;
  await new Promise(resolve=>setTimeout(resolve,500));
 }while(more);
}
data.players=[...players.values()].sort((a,b)=>a.handle.localeCompare(b.handle,'fr'));
data.sources=[...new Set([...(data.sources||[]),...categories.map(([,c])=>'https://en.wikipedia.org/wiki/Category:'+c.replaceAll(' ','_'))])];
await fs.writeFile(new URL('./esports-catalog.previous.json',import.meta.url),await fs.readFile(file));
await fs.writeFile(file,JSON.stringify(data,null,2)+'\n');
console.log(`${added} joueurs ajoutés ; ${data.players.length} au total. Les identifiants et photos existants ont été conservés.`);
