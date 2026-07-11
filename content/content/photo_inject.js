// Fast4FBMP content/photo_inject.js
(function(){
const F4=window.F4=window.F4||{};

function dataUrlToFile(p,i){
  const [head,b64]=String(p.dataUrl).split(',');
  const mime=p.mime||(head.match(/data:(.+?);/)||[])[1]||'image/jpeg';
  const bin=atob(b64);
  const arr=new Uint8Array(bin.length);
  for(let j=0;j<bin.length;j++)arr[j]=bin.charCodeAt(j);
  return new File([arr],p.name||('photo'+i+'.jpg'),{type:mime});
}

function toFiles(photos){
  return (photos||[]).filter(p=>p&&p.dataUrl).map(dataUrlToFile);
}

async function injectInto(inputSelectorOrEl,photos){
  const files=toFiles(photos);
  if(!files.length)return false;
  const input=typeof inputSelectorOrEl==='string'
    ?document.querySelector(inputSelectorOrEl)
    :inputSelectorOrEl;
  if(!input)return false;
  const dt=new DataTransfer();
  files.forEach(f=>dt.items.add(f));
  try{
    const desc=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'files');
    desc.set.call(input,dt.files);
  }catch(e){
    try{input.files=dt.files;}catch(e2){return false;}
  }
  input.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
}

F4.photos={toFiles,injectInto,dataUrlToFile};
})();
