// Fast4FBMP lib/fs_local.js
(function(){
const NS=window.F4Local=window.F4Local||{};
const DB='fast4fbmpfs',STORE='handles';

function idb(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
async function saveHandle(h){const db=await idb();db.transaction(STORE,'readwrite').objectStore(STORE).put(h,'root');}
async function loadHandle(){
  const db=await idb();
  return new Promise(res=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).get('root');r.onsuccess=()=>res(r.result||null);r.onerror=()=>res(null);});
}
async function ensurePermission(handle){
  const opts={mode:'readwrite'};
  if(await handle.queryPermission(opts)==='granted')return true;
  return await handle.requestPermission(opts)==='granted';
}

NS.chooseRoot=async function(){
  const root=await window.showDirectoryPicker({id:'fast4fbmp',mode:'readwrite'});
  await saveHandle(root);
  await root.getDirectoryHandle('Active',{create:true});
  await root.getDirectoryHandle('Sold',{create:true});
  await root.getDirectoryHandle('fbmpvideo',{create:true});
  return root;
};

NS.getRoot=async function(){
  const root=await loadHandle();
  if(root&&await ensurePermission(root))return root;
  return null;
};

async function writeFile(dir,name,data){
  const fh=await dir.getFileHandle(name,{create:true});
  const w=await fh.createWritable();
  await w.write(data);await w.close();
}
function dataUrlToBlob(dataUrl){
  const [head,b64]=String(dataUrl).split(',');
  const mime=(head.match(/data:(.+?);/)||[])[1]||'image/jpeg';
  const bin=atob(b64);const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function toCsvRow(l){
  const cols=['id','title','price','category','description','url'];
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  return [cols.join(','),cols.map(c=>esc(l[c])).join(',')].join('\n');
}
function blobToDataUrl(blob){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob);});
}

NS.writeListing=async function(listing,photos,folder='Active'){
  const root=await NS.getRoot();if(!root)throw new Error('No local folder selected.');
  const base=await root.getDirectoryHandle(folder,{create:true});
  const dir=await base.getDirectoryHandle(String(listing.id),{create:true});
  listing.lastModified=listing.lastModified||Date.now();
  await writeFile(dir,'listing.json',JSON.stringify(listing,null,2));
  await writeFile(dir,'listing.csv',toCsvRow(listing));
  const pics=photos||listing.photos||[];
  for(let i=0;i<pics.length;i++){
    const p=pics[i];const name=p.name||('photo'+i+'.jpg');
    if(p.blob)await writeFile(dir,name,p.blob);
    else if(p.dataUrl)await writeFile(dir,name,dataUrlToBlob(p.dataUrl));
  }
  return true;
};

NS.writeVideo=async function(id,blob,ext){
  const root=await NS.getRoot();if(!root)throw new Error('No local folder selected.');
  const dir=await root.getDirectoryHandle('fbmpvideo',{create:true});
  const name=String(id)+'.'+(ext||'mp4');
  try{await dir.getFileHandle(name,{create:false});return {skipped:true,name};}catch(e){}
  const fh=await dir.getFileHandle(name,{create:true});
  const w=await fh.createWritable();await w.write(blob);await w.close();
  return {skipped:false,name,size:blob.size};
};

NS.hasVideo=async function(id){
  const root=await NS.getRoot();if(!root)return false;
  try{
    const dir=await root.getDirectoryHandle('fbmpvideo',{create:true});
    for await(const [name] of dir.entries())if(name.startsWith(String(id)+'.'))return true;
  }catch(e){}
  return false;
};

NS.markSold=async function(id){
  const root=await NS.getRoot();if(!root)throw new Error('No local folder selected.');
  const active=await root.getDirectoryHandle('Active',{create:true});
  const sold=await root.getDirectoryHandle('Sold',{create:true});
  const src=await active.getDirectoryHandle(String(id));
  const dst=await sold.getDirectoryHandle(String(id),{create:true});
  for await(const [name,h] of src.entries()){
    if(h.kind==='file'){const f=await h.getFile();await writeFile(dst,name,f);}
  }
  await active.removeEntry(String(id),{recursive:true});
  return true;
};

NS.readAll=async function(folder='Active'){
  const root=await NS.getRoot();if(!root)throw new Error('No local folder selected.');
  const base=await root.getDirectoryHandle(folder,{create:true});
  const out=[];
  for await(const [id,dir] of base.entries()){
    if(dir.kind!=='directory')continue;
    try{
      const rec=JSON.parse(await readText(dir,'listing.json'));
      const photos=[];
      for await(const [name,fh] of dir.entries()){
        if(fh.kind!=='file'||!/\.(jpe?g|png|webp)$/i.test(name))continue;
        const file=await fh.getFile();
        photos.push({name,mime:file.type||'image/jpeg',dataUrl:await blobToDataUrl(file)});
      }
      rec.photos=photos;out.push(rec);
    }catch(e){}
  }
  return out;
};

NS.readMeta=async function(root,folder='Active'){
  let base;try{base=await root.getDirectoryHandle(folder,{create:false});}catch(e){return[];}
  const out=[];
  for await(const [id,dir] of base.entries()){
    if(dir.kind!=='directory')continue;
    try{out.push(JSON.parse(await readText(dir,'listing.json')));}catch(e){}
  }
  return out;
};

NS.readPhotos=async function(root,id,folder='Active'){
  const base=await root.getDirectoryHandle(folder,{create:false});
  const dir=await base.getDirectoryHandle(String(id),{create:false});
  const photos=[];
  for await(const [name,fh] of dir.entries()){
    if(fh.kind!=='file'||!/\.(jpe?g|png|webp)$/i.test(name))continue;
    const file=await fh.getFile();
    photos.push({name,mime:file.type||'image/jpeg',dataUrl:await blobToDataUrl(file)});
  }
  return photos;
};

NS.pickFolder=function(){return window.showDirectoryPicker({mode:'read'});};

async function readText(dir,name){
  const fh=await dir.getFileHandle(name);const f=await fh.getFile();return f.text();
}
})();
