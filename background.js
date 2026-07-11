// Fast4FBMP background.js
const STATE={running:false,cancel:false,done:[],failed:[],tabId:null,settings:null};
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
function gauss(min,max){let s=0;for(let i=0;i<3;i++)s+=Math.random();return min+(s/3)*(max-min);}
function emit(event,data){chrome.runtime.sendMessage(Object.assign({type:'f4status',event},data)).catch(()=>{});}

async function getActiveFbTab(){
  if(STATE.tabId){try{const t=await chrome.tabs.get(STATE.tabId);if(t)return await focusTab(t);}catch(e){}}
  const tabs=await chrome.tabs.query({url:'https://www.facebook.com/*',active:true});
  if(tabs[0]){STATE.tabId=tabs[0].id;return await focusTab(tabs[0]);}
  const all=await chrome.tabs.query({url:'https://www.facebook.com/*'});
  if(all[0]){STATE.tabId=all[0].id;return await focusTab(all[0]);}
  return null;
}
async function focusTab(tab){
  try{await chrome.tabs.update(tab.id,{active:true});}catch(e){}
  try{if(tab.windowId!=null)await chrome.windows.update(tab.windowId,{focused:true});}catch(e){}
  return tab;
}
async function navigate(tabId,url,expectPath){
  await chrome.tabs.update(tabId,{url});
  const end=Date.now()+25000;
  while(Date.now()<end){
    await sleep(700);
    let tab;try{tab=await chrome.tabs.get(tabId);}catch(e){continue;}
    if(tab.status!=='complete')continue;
    if(expectPath&&!tab.url.includes(expectPath))continue;
    try{const r=await chrome.tabs.sendMessage(tabId,{type:'f4ping'});if(r&&r.ok)return true;}catch(e){}
  }
  return false;
}
async function sendRetry(tabId,msg,tries=3){
  let lastErr;
  for(let i=0;i<tries;i++){
    try{return await chrome.tabs.sendMessage(tabId,msg);}catch(e){lastErr=e;await sleep(1200);}
  }
  throw lastErr;
}
async function getOwnProfileUrl(tabId){
  try{
    const c=await chrome.cookies.get({url:'https://www.facebook.com',name:'c_user'});
    if(c&&/^\d+$/.test(c.value))return 'https://www.facebook.com/marketplace/profile/'+c.value;
  }catch(e){}
  try{
    const [{result}]=await chrome.scripting.executeScript({target:{tabId},func:()=>{
      const a=Array.from(document.querySelectorAll('a[href*="marketplace/profile"]')).map(x=>x.href).find(h=>/marketplace\/profile\/\d+/.test(h));
      return a||null;
    }});
    if(result){const m=result.match(/marketplace\/profile\/(\d+)/);if(m)return 'https://www.facebook.com/marketplace/profile/'+m[1];}
  }catch(e){}
  return null;
}
async function runScan(){
  const tab=await getActiveFbTab();
  if(!tab){emit('error',{message:'Open Facebook Marketplace in a tab first.'});return;}
  emit('scanstart',{});
  const profileUrl=await getOwnProfileUrl(tab.id);
  if(!profileUrl){emit('error',{message:"Couldn't detect your profile. Make sure you're logged into Facebook."});return;}
  emit('progress',{text:'Scanning: '+profileUrl});
  const ok=await navigate(tab.id,profileUrl,'marketplace/profile');
  if(!ok){emit('error',{message:"Couldn't reach your profile page."});return;}
  try{
    const res=await sendRetry(tab.id,{type:'f4scanpublished'});
    if(res&&res.ok){
      emit('scandone',{items:res.items});
      await chrome.storage.local.set({f4scanned:res.items,f4scannedat:Date.now()});
    }else{emit('error',{message:(res&&res.error)||'Scan failed'});}
  }catch(e){emit('error',{message:String(e.message||e)});}
}
async function runBulk(settings){
  if(STATE.running){emit('error',{message:'A job is already running.'});return;}
  STATE.running=true;STATE.cancel=false;STATE.done=[];STATE.failed=[];
  const tab=await getActiveFbTab();
  if(!tab){STATE.running=false;emit('error',{message:'Open Facebook in a tab first.'});return;}
  let ids=settings.ids.slice().sort(()=>Math.random()-0.5);
  if(settings.cap>0)ids=ids.slice(0,settings.cap);
  emit('bulkstart',{total:ids.length});
  for(let i=0;i<ids.length;i++){
    if(STATE.cancel){emit('cancelled',{});break;}
    const id=ids[i];
    try{
      emit('itemextract',{id,index:i+1,total:ids.length});
      await navigate(tab.id,'https://www.facebook.com/marketplace/item/'+id,'marketplace/item');
      const ex=await sendRetry(tab.id,{type:'f4extractitem',id});
      if(!ex||!ex.ok||!ex.data||!ex.data.title)throw new Error('extract failed');
      const item=ex.data;
      item.category=(settings.categoryMap&&settings.categoryMap[id])||item.category;
      try{await chrome.storage.local.set({['item_'+id]:item});}catch(e){}
      emit('itemcreate',{id,index:i+1,total:ids.length,title:item.title});
      await navigate(tab.id,'https://www.facebook.com/marketplace/create/item','marketplace/create');
      const cr=await sendRetry(tab.id,{type:'f4createone',item,autoPublish:settings.autoPublish});
      if(!cr||!cr.ok)throw new Error((cr&&cr.error)||'create failed');
      STATE.done.push({id,...cr.result});
      emit('itemdone',{id,result:cr.result,done:STATE.done.length,failed:STATE.failed.length});
    }catch(e){
      STATE.failed.push({id,error:String(e.message||e)});
      emit('itemfailed',{id,error:String(e.message||e),done:STATE.done.length,failed:STATE.failed.length});
    }
    if(i<ids.length-1&&!STATE.cancel){
      let gap=gauss(settings.minGap||60,settings.maxGap||180);
      if(settings.breakEvery>0&&(i+1)%settings.breakEvery===0)
        gap=gauss(settings.breakMin||300,settings.breakMax||600);
      emit('waiting',{seconds:Math.round(gap)});
      const ticks=Math.round(gap);
      for(let t=0;t<ticks;t++){if(STATE.cancel)break;await sleep(1000);emit('countdown',{remaining:ticks-t-1});}
    }
  }
  STATE.running=false;
  emit('bulkdone',{done:STATE.done.length,failed:STATE.failed.length,results:STATE.done,failures:STATE.failed});
  try{chrome.notifications.create({type:'basic',iconUrl:'images/icon128.png',title:'Fast4FBMP',message:'Done: '+STATE.done.length+' created, '+STATE.failed.length+' failed.'});}catch(e){}
}
async function fetchPhotosBg(urls){
  const out=[];
  for(let i=0;i<urls.length;i++){
    try{
      const r=await fetch(urls[i]);if(!r.ok)continue;
      const buf=await r.arrayBuffer();
      const mime=r.headers.get('content-type')||'image/jpeg';
      const ext=mime.includes('png')?'png':mime.includes('webp')?'webp':'jpg';
      const bytes=new Uint8Array(buf);let bin='';
      const chunk=0x8000;
      for(let j=0;j<bytes.length;j+=chunk)bin+=String.fromCharCode.apply(null,bytes.subarray(j,j+chunk));
      out.push({name:i+'.'+ext,mime,dataUrl:'data:'+mime+';base64,'+btoa(bin)});
    }catch(e){}
  }
  return out;
}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  switch(msg.type){
    case 'f4runscan':runScan();sendResponse({ok:true});break;
    case 'f4runbulk':runBulk(msg.settings);sendResponse({ok:true});break;
    case 'f4cancel':STATE.cancel=true;sendResponse({ok:true});break;
    case 'f4getstate':sendResponse({ok:true,running:STATE.running,done:STATE.done.length,failed:STATE.failed.length});break;
    case 'f4fetchphotos':
      fetchPhotosBg(msg.urls||[]).then(photos=>sendResponse({ok:true,photos})).catch(e=>sendResponse({ok:false,error:String(e.message)}));
      return true;
  }
  return true;
});
chrome.action.onClicked.addListener(async tab=>{
  try{await chrome.sidePanel.open({tabId:tab.id});}catch(e){
    try{chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});}catch(e2){}
  }
});
console.log('Fast4FBMP background ready.');
