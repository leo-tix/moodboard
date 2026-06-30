import type { Metadata } from "next";
import { BookmarkletSection } from "@/components/settings/BookmarkletSection";

export const metadata: Metadata = { title: "Extensions" };

export default function ExtensionsPage() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  // Bookmarklet JS — extracts the main image from the current page and opens
  // the Moodboard import page in a new tab. Supports Instagram and Pinterest.
  const bookmarkletCode = `javascript:(function(){
var APP='${appUrl}';
function best(img){
  if(!img.srcset)return img.currentSrc||img.src;
  var p=img.srcset.split(',').map(function(s){var t=s.trim().split(/\\s+/);return{u:t[0],w:parseInt(t[1]||'0')};});
  p.sort(function(a,b){return b.w-a.w;});
  return p[0].u||img.src;
}
var imgUrl='',author='',src=location.href;
if(location.hostname.includes('instagram.com')){
  var imgs=[].slice.call(document.querySelectorAll('article img[srcset],main img[srcset]'));
  imgs=imgs.filter(function(i){return i.naturalWidth>100||parseInt(i.getAttribute('width')||'0')>100;});
  if(imgs[0])imgUrl=best(imgs[0]);
  var a=document.querySelector('header a[href*="/"]');
  if(a)author=a.textContent.trim();
}else if(location.hostname.includes('pinterest.com')){
  var pin=document.querySelector('[data-test-id="closeup-image-main"] img,[data-test-id="pin-closeup-image"] img,.GrowthUnauthPinImage img');
  if(pin)imgUrl=best(pin);
}else{
  var all=[].slice.call(document.images).filter(function(i){return i.naturalWidth>200;});
  all.sort(function(a,b){return(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight);});
  if(all[0])imgUrl=all[0].currentSrc||all[0].src;
}
if(!imgUrl){alert('Moodboard : aucune image trouvée sur cette page.');return;}
var q=new URLSearchParams({imageUrl:imgUrl,sourceUrl:src,author:author});
window.open(APP+'/import/bookmarklet?'+q.toString());
})();`.replace(/\n/g, "").replace(/\s{2,}/g, " ");

  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-sm font-medium text-[var(--text-primary)] mb-6">Extensions</h2>
      <BookmarkletSection bookmarkletCode={bookmarkletCode} />
    </div>
  );
}
