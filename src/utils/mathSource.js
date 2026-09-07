// Split only paired delimiters. Unmatched currency signs remain ordinary text.
export function splitMathSource(value) {
  const text=String(value ?? '');
  const parts=[];let start=0,i=0;
  const escaped=pos=>{let n=0;while(pos>0&&text[--pos]==='\\')n++;return n%2===1;};
  while(i<text.length){
    let open='',close='';
    if(!escaped(i)){
      if(text.startsWith('\\[',i)){open='\\[';close='\\]';}
      else if(text.startsWith('\\(',i)){open='\\(';close='\\)';}
      else if(text.startsWith('$$',i)){open=close='$$';}
      else if(text[i]==='$'){open=close='$';}
    }
    if(!open){i++;continue;}
    let end=i+open.length;
    while((end=text.indexOf(close,end))>=0 && escaped(end))end+=close.length;
    if(end<0){i+=open.length;continue;}
    if(i>start)parts.push({text:text.slice(start,i),math:false});
    parts.push({text:text.slice(i+open.length,end),math:true,display:open==='$$'||open==='\\['});
    i=end+close.length;start=i;
  }
  if(start<text.length)parts.push({text:text.slice(start),math:false});
  return parts;
}
