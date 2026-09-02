const fs=require('fs');
const p='app/index.html';
let s=fs.readFileSync(p,'utf8');
if(!s.includes('WZ MANAGE PRO — ONLINE EMPLOYEE + AUTH BRIDGE')){
  s=s.replace("const apiBase=(localStorage.getItem(ONLINE_KEY)||window.WZ_ONLINE_API||'').replace(/\\/+$/,'');", "const apiBase=(localStorage.getItem(ONLINE_KEY)||window.WZ_ONLINE_API||location.origin).replace(/\\/+$/,'');");
  s=s.replace("</script>\n\n</script>\n</body>","</script>\n</body>");
  const addon=fs.readFileSync('tools/online-bridge.js','utf8');
  s=s.replace('</body>',addon+'\n</body>');
  fs.writeFileSync(p,s);
}
