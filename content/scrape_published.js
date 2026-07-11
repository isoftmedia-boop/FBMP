// Fast4FBMP content/scrape_published.js
(function(){
const F4=window.F4=window.F4||{};
const H=F4.human=F4.human||{
  sleep:ms=>new Promise(r=>setTimeout(r,ms)),
  gauss:(a,b)=>{let s=0;for(let i=0;i<3;i++)s+=Math.random();return a+(s/3)*(b-a)},
  pause:()=>Promise.resolve()
};

function isFbCdn(src){return /fbcdn\.net|scontent-/.test(src);}
function canonical(src){try{const u=new URL(src);return u.origin+u.pathname;}catch(e){return String(src).split('?')[0];}}

function collectItemLinks(){
  const out=new Map();
  document.querySelectorAll('a[href*="marketplace/item"]').forEach(a=>{
    try{
      const m=a.href.match(/marketplace\/item\/(\d+)/);if(!m)return;
      const id=m[1];if(out.has(id))return;
      const txt=a.innerText.trim();
      const lines=txt.split('\n').map(l=>l.trim()).filter(l=>l.length>1);
      const priceVal=lines.find(l=>/^\$[\d,]+/.test(l))||'';
      const title=lines.filter(l=>!/^\$|Active|Sold|Pending|clicks|Listed|Reno|Sparks|wdhm/i.test(l)).sort((x,y)=>y.length-x.length)[0]||'';
      if(!title)return;
      const img=a.querySelector('img');
      const photoUrl=img&&isFbCdn(img.src)?img.src:'';
      out.set(id,{id,url:'https://www.facebook.com/marketplace/item/'+id,title,price:priceVal.replace(/[^\d]/g,''),photoUrl});
    }catch(e){}
  });
  return out;
}

function getScrollables(){
  const out=[];
  document.querySelectorAll('div').forEach(d=>{
    try{const s=getComputedStyle(d);if(/auto|scroll/.test(s.overflowY)&&d.scrollHeight>d.clientHeight+200)out.push(d);}catch(e){}
  });
  return out.sort((a,b)=>b.scrollHeight-a.scrollHeight);
}

async function waitForListings(ms=12000){
  const end=Date.now()+ms;
  while(Date.now()<end){if(document.querySelectorAll('a[href*="marketplace/item"]').length>0)return true;await H.sleep(400);}
  return false;
}

async function scanPublished(onProgress){
  if(!/marketplace\/profile/.test(location.href))throw new Error('Not on the Marketplace profile page.');
  await waitForListings();
  const found=new Map();let lastCount=0,stable=0;
  for(let pass=0;pass<200&&stable<6;pass++){
    collectItemLinks().forEach((v,k)=>{if(!found.has(k)){found.set(k,v);if(onProgress)onProgress(found.size);}});
    const anchors=document.querySelectorAll('a[href*="marketplace/item"]');
    if(anchors.length)try{anchors[anchors.length-1].scrollIntoView({block:'end'});}catch(e){}
    getScrollables().slice(0,3).forEach(c=>{try{c.scrollTop=c.scrollHeight;}catch(e){}});
    window.scrollTo(0,document.body.scrollHeight);
    await H.sleep(H.gauss(1500,2400));
    collectItemLinks().forEach((v,k)=>{if(!found.has(k))found.set(k,v);});
    if(found.size===lastCount)stable++;else{stable=0;lastCount=found.size;}
    console.log('Fast4FBMP scan pass '+(pass+1)+': '+found.size+' listings');
  }
  return Array.from(found.values());
}

async function extractCurrentItem(id){
  await H.sleep(H.gauss(2500,4000));
  if(!location.href.includes('/marketplace/item/'+id))
    return {id,title:'',price:'',condition:'',description:'',photos:[],url:location.href,error:'wrong page'};
  const main=document.querySelector('[role="main"]')||document.body;
  const titleEl=main.querySelector('h1 span')||main.querySelector('h1');
  const title=titleEl?titleEl.innerText.trim():'';
  const priceMatch=main.innerText.match(/\$[\d,]+\.?\d*/);
  const price=priceMatch?priceMatch[0]:'';
  const condMatch=main.innerText.match(/New with tags|New without tags|New|Used[\s\-]*Like New|Used[\s\-]*Good|Used[\s\-]*Fair|Like New|Good|Fair|For parts/i);
  const condition=condMatch?condMatch[0]:'';
  const descs=Array.from(main.querySelectorAll('div[dir="auto"],span[dir="auto"]'))
    .map(e=>e.innerText.trim()).filter(t=>t.length>40&&t.length<4000)
    .sort((a,b)=>b.length-a.length);
  const description=descs[0]||'';
  const seen=new Set();const photos=[];
  main.querySelectorAll('img').forEach(img=>{
    const src=img.currentSrc||img.src||'';
    if(!isFbCdn(src))return;
    const w=img.naturalWidth||img.width||0,h=img.naturalHeight||img.height||0;
    if(w>0&&w<350)return;if(h>0&&h<350)return;
    if(/p\d+x\d+|s\d+x\d+|_t\.jpg|_s\.jpg|_n\.jpg/.test(src))return;
    if(/profile|avatar|emoji|sticker|logo|icon/i.test(src))return;
    const anchor=img.closest('a[href*="marketplace/item"],a[href*="/item/"]');
    if(anchor){const m=(anchor.getAttribute('href')||'').match(/item\/(\d+)/);if(m&&m[1]!==String(id))return;}
    let node=img,bad=false;
    for(let d=0;d<10;d++){
      node=node.parentElement;if(!node)break;
      const prev=node.previousElementSibling;
      if(prev&&/More from|Related|Similar|Suggested|Sponsored|You might|People also/i.test(prev.innerText||'')){bad=true;break;}
    }
    if(bad)return;
    const k=canonical(src);
    if(!seen.has(k)){seen.add(k);photos.push(src);}
  });
  const photoBlobs=[];
  for(let i=0;i<Math.min(photos.length,10);i++){
    try{
      const resp=await fetch(photos[i]);const blob=await resp.blob();
      const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob);});
      photoBlobs.push({name:id+'_'+i+'.jpg',mime:blob.type||'image/jpeg',dataUrl});
    }catch(e){console.warn('photo fetch failed',e);}
    await H.sleep(H.gauss(200,600));
  }
  return {id,title,price,condition,description,photos:photoBlobs,photoCount:photoBlobs.length,url:location.href};
}

function extractVideoUrl(){
  const keys=['browsernativehdurl','browsernativesdurl','playableurlqualityhd','playableurl'];
  const html=document.documentElement.innerHTML;
  for(const k of keys){const m=html.match(new RegExp(k+'":"(https?[^"]+)'));if(m){try{return JSON.parse('"'+m[1]+'"');}catch(e){return m[1].replace(/\\/g,'');}}}
  const v=document.querySelector('video[src],video source[src]');
  if(v){const s=v.getAttribute('src');if(s&&!s.startsWith('blob:'))return s;}
  return null;
}

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg.type==='f4ping'){sendResponse({ok:true,url:location.href});return;}
  if(msg.type==='f4scanpublished'){
    scanPublished(n=>chrome.runtime.sendMessage({type:'f4status',event:'progress',text:'Found '+n+' listings...'}).catch(()=>{}))
      .then(items=>sendResponse({ok:true,items}))
      .catch(e=>sendResponse({ok:false,error:String(e.message||e)}));
    return true;
  }
  if(msg.type==='f4extractitem'){
    extractCurrentItem(msg.id)
      .then(data=>sendResponse({ok:true,data}))
      .catch(e=>sendResponse({ok:false,error:String(e.message||e)}));
    return true;
  }
  if(msg.type==='f4getvideourl'){
    sendResponse({ok:true,url:extractVideoUrl()});
  }
});
})();
