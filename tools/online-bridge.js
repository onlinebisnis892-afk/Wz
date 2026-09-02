<script>
/* WZ MANAGE PRO — ONLINE EMPLOYEE + AUTH BRIDGE */
(function(){
'use strict';
async function api(path,options={}){const res=await fetch('/api/'+path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch{}if(!res.ok)throw new Error(data?.error||data?.message||('HTTP '+res.status));return data;}
window.WZOnlineEmployee={api};
async function syncBusiness(){
  if(!currentUser)return;
  try{
    const mine=x=>currentUser.role==='employee'?String(x.employeeId)===String(currentUser.employeeId):true;
    const localTx=(db.transactions||[]).filter(mine);
    const localShifts=(db.shiftReports||[]).filter(r=>mine(r)&&!/^KYONGSHIFT\d+$/i.test(String(r.id||'')));
    // Read the server first. This prevents an old local snapshot from overwriting
    // newer online data on login or on a second device.
    const r=await api('business');
    const serverTx=Array.isArray(r.transactions)?r.transactions:[];
    const serverSh=Array.isArray(r.shiftReports)?r.shiftReports:[];
    const serverTxIds=new Set(serverTx.map(x=>String(x.id)));
    const serverShIds=new Set(serverSh.map(x=>String(x.id)));
    const pendingTx=localTx.filter(t=>!serverTxIds.has(String(t.id))).map(t=>({...t,customerName:getCustomer(t.customerId)?.name||null,serviceName:getService(t.serviceId)?.name||null,servicePrice:Number(getService(t.serviceId)?.price||t.servicePrice||0),employeeName:getEmployee(t.employeeId)?.name||null}));
    const pendingSh=localShifts.filter(r=>!serverShIds.has(String(r.id)));
    if(pendingTx.length||pendingSh.length) await api('sync-business',{method:'POST',body:JSON.stringify({transactions:pendingTx,shiftReports:pendingSh})});
    // An offline VOID must still reach the server once connectivity returns.
    const serverTxMap=new Map(serverTx.map(x=>[String(x.id),x]));
    for(const t of localTx){const st=serverTxMap.get(String(t.id));if(st&&String(t.status)==='VOID'&&String(st.status)!=='VOID')try{await api('transaction/void',{method:'POST',body:JSON.stringify({id:t.id})});}catch{}}
    const fresh=await api('business');
    if(Array.isArray(fresh.transactions)){
      const byId=new Map((db.transactions||[]).map(x=>[x.id,x]));
      for(const t of fresh.transactions){const x=byId.get(t.id)||{id:t.id};Object.assign(x,{date:String(t.date).slice(0,10),customerId:t.customerId||x.customerId||'',customerName:t.customerName||x.customerName||'',serviceId:t.serviceId||x.serviceId||'',serviceName:t.serviceName||x.serviceName||'',servicePrice:Number(t.servicePrice||x.servicePrice||0),employeeId:t.employeeId||x.employeeId||'',employeeName:t.employeeName||x.employeeName||'',total:Number(t.total||0),payment:t.payment||'Tunai',status:t.status||'SELESAI',discount:Number(t.discount||x.discount||0)});
        if(t.customerId&&t.customerName&&!getCustomer(t.customerId))db.customers.push({id:t.customerId,name:t.customerName,phone:'',visits:0,total:0,status:'Aktif'});
        if(t.serviceId&&t.serviceName&&!getService(t.serviceId))db.services.push({id:t.serviceId,name:t.serviceName,category:'Umum',price:Number(t.servicePrice||0),duration:0,active:true});
        if(t.employeeId&&t.employeeName&&!getEmployee(t.employeeId))db.employees.push({id:t.employeeId,name:t.employeeName,role:'Barber',salary:0,commission:0,target:0,attendance:0,eval:0,active:true,branchId:null});
        if(!byId.has(t.id))db.transactions.push(x);}
    }
    if(Array.isArray(fresh.shiftReports)){
      const byId=new Map((db.shiftReports||[]).map(x=>[x.id,x]));
      for(const rr of fresh.shiftReports){const x=byId.get(rr.id)||{id:rr.id};Object.assign(x,{date:String(rr.date).slice(0,10),employeeId:rr.employeeId||x.employeeId,employeeName:rr.employeeName||x.employeeName,shiftType:rr.shiftType||x.shiftType,customers:Number(rr.customers||0),openingCash:Number(rr.openingCash||0),cash:Number(rr.cash||0),qris:Number(rr.qris||0),cashExpense:Number(rr.cashExpense||0),physicalCash:Number(rr.physicalCash||0),totalPayment:Number(rr.totalPayment||0),expectedCash:Number(rr.expectedCash||0),cashDifference:Number(rr.cashDifference||0),serviceTotal:Number(rr.serviceTotal||0),productTotal:Number(rr.productTotal||0),totalOmzet:Number(rr.totalOmzet||0),services:rr.services||[],products:rr.products||[],note:rr.note||''});if(!byId.has(rr.id))db.shiftReports.push(x);}
    }
    save();
    return true;
  }catch(e){console.warn('Online business sync skipped:',e.message||e);return false;}
}
window.WZOnlineBusiness={sync:syncBusiness};

async function syncEmployeesFromServer(){
  if(!currentUser || !['owner','manager'].includes(currentUser.role)) return;
  try{
    const r=await api('employees');
    const server=Array.isArray(r?.employees)?r.employees:[];
    if(!Array.isArray(db.employees)) db.employees=[];
    const serverIds=new Set(server.map(x=>String(x.id)));
    db.employees.forEach(le=>{if(/^E\d+$/.test(String(le.id))&&!serverIds.has(String(le.id)))le.active=false;});
    for(const se of server){
      let le=db.employees.find(x=>x.id===se.id);
      if(!le){
        le={id:se.id,name:se.name,role:se.role||'Barber',branchId:se.branchId||null,salary:Number(se.salary)||0,commission:Number(se.commission)||0,target:Number(se.target)||0,attendance:Number(se.attendance)||0,eval:Number(se.eval)||0,active:se.active!==false};
        db.employees.push(le);
      }else{
        le.name=se.name; le.role=se.role||le.role; le.branchId=se.branchId||le.branchId; le.salary=Number(se.salary)||le.salary||0; le.commission=Number(se.commission)||le.commission||0; le.target=Number(se.target)||le.target||0; le.active=se.active!==false;
      }
    }
    save();
    if(typeof render==='function') render();
  }catch(e){ console.warn('Online employee sync skipped:',e.message||e); }
}
window.WZOnlineEmployee.syncEmployeesFromServer=syncEmployeesFromServer;
const localLogin=window.login;
window.login=async function(ev){ev.preventDefault();const u=(document.getElementById('loginUser')?.value||'').trim(),p=document.getElementById('loginPass')?.value||'',err=document.getElementById('loginError');try{const r=await api('auth/login',{method:'POST',body:JSON.stringify({username:u,password:p})});if(err)err.style.display='none';currentUser=r.user;sessionStorage.setItem(SESSION_STORE,JSON.stringify(r.user));const screen=document.getElementById('loginScreen');if(screen)screen.style.display='none';const badge=document.getElementById('roleBadge');if(badge)badge.textContent=r.user.name;render();await syncEmployeesFromServer();await syncBusiness();}catch(e){if(err){err.textContent=e.message||'Login gagal.';err.style.display='block';}else alert(e.message||'Login gagal.');if(/Failed to fetch|NetworkError|DATABASE_URL|500|Endpoint tidak ditemukan/i.test(String(e.message||''))&&typeof localLogin==='function'){try{localLogin(ev)}catch{}}}};
window.logout=async function(){try{await api('auth/logout',{method:'POST'})}catch{}sessionStorage.removeItem(SESSION_STORE);currentUser=null;const screen=document.getElementById('loginScreen');if(screen)screen.style.display='flex';const u=document.getElementById('loginUser'),pw=document.getElementById('loginPass');if(u)u.value='';if(pw)pw.value='';};
api('auth/me').then(r=>{currentUser=r.user;sessionStorage.setItem(SESSION_STORE,JSON.stringify(r.user));const screen=document.getElementById('loginScreen');if(screen)screen.style.display='none';const badge=document.getElementById('roleBadge');if(badge)badge.textContent=r.user.name;render();syncEmployeesFromServer();syncBusiness();}).catch(()=>{});
const localSaveEmployee=window.saveEmployee;
window.saveEmployee=async function(id){if(!guard('employees'))return;const name=(document.getElementById('eName')?.value||'').trim(),role=document.getElementById('eRole')?.value||'Barber',password=(document.getElementById('ePassword')?.value||'').trim(),branchId=document.getElementById('eBranch')?.value||'',salary=Number(document.getElementById('eSalary')?.value||0),target=Number(document.getElementById('eTarget')?.value||0);if(!name)return alert('Isi nama karyawan');if(!password)return alert('Isi password login');if(!branchId)return alert('Pilih cabang karyawan');let employeeId=id||'';if(!employeeId){const next=Math.max(0,...(db.employees||[]).map(x=>Number(String(x.id).replace(/\D/g,''))||0))+1;employeeId='E'+String(next).padStart(3,'0');}const username=(name.trim().toLowerCase().replace(/[^a-z0-9]+/g,''))||'employee';try{await api('employees',{method:id?'PUT':'POST',body:JSON.stringify({id:employeeId,name,role,password,username,branchId,salary,target})});if(typeof localSaveEmployee==='function')await localSaveEmployee(id||'');toast(id?'Data karyawan & akun online diperbarui.':'Karyawan & akun login online dibuat.');}catch(e){alert('Gagal menyimpan ke server: '+e.message);}};
const localDeleteEmployee=window.deleteEmployee;
window.deleteEmployee=async function(id){if(!guard('employees'))return;const e=getEmployee(id);if(!e)return;if(!confirm('Hapus karyawan '+e.name+' beserta akun login karyawan ini?'))return;try{await api('employees?id='+encodeURIComponent(id),{method:'DELETE'});if(typeof localDeleteEmployee==='function')localDeleteEmployee(id);}catch(err){alert('Gagal menghapus dari server: '+err.message);}};

const localSaveTransaction=window.saveTransaction;
window.saveTransaction=async function(){
  const ok=typeof localSaveTransaction==='function';
  if(!ok)return;
  const customerId=document.getElementById('fCustomer')?.value||'',serviceId=document.getElementById('fService')?.value||'',employeeEl=document.getElementById('fEmployee'),employeeId=currentUser?.role==='employee'?(currentUser.employeeId||''):(employeeEl?.value||'');
  if(currentUser?.role==='employee'&&(!employeeId||!getEmployee(employeeId))){alert('Akun karyawan tidak memiliki ID karyawan yang valid.');return;}
  if(currentUser?.role==='employee'&&employeeEl)employeeEl.value=employeeId;
  const svc=getService(serviceId),emp=getEmployee(employeeId),customer=getCustomer(customerId),discount=Number(document.getElementById('fDiscount')?.value||0),total=Math.max(0,Number(svc?.price||0)-discount),stableTxId='TRX'+Date.now();
  const previousTxId=window.__wzTransactionStableId; window.__wzTransactionStableId=stableTxId; const id=stableTxId;
  const payload={id,date:dateNow(),customerId,customerName:customer?.name||null,serviceId,serviceName:svc?.name||null,servicePrice:Number(svc?.price||0),employeeId,employeeName:emp?.name||null,total,payment:document.getElementById('fPayment')?.value||'Tunai',discount,status:'SELESAI'};
  try{await api('transaction',{method:'POST',body:JSON.stringify(payload)});await localSaveTransaction();window.__wzTransactionStableId=previousTxId;}catch(e){window.__wzTransactionStableId=previousTxId;await localSaveTransaction();toast('Transaksi tersimpan lokal; server belum tersinkron: '+e.message);return;}
  syncBusiness();
};
const localVoidTx=window.voidTx;
window.voidTx=async function(id){try{await api('transaction/void',{method:'POST',body:JSON.stringify({id})});if(typeof localVoidTx==='function')localVoidTx(id);syncBusiness();}catch(e){alert('Gagal void online: '+e.message);}};
const localSaveShiftReport=window.saveShiftReport;
window.saveShiftReport=async function(){
  if(typeof localSaveShiftReport!=='function')return;
  const c=typeof calcShiftReport==='function'?calcShiftReport():null;
  if(c&&Math.abs(c.difference)>0.001){localSaveShiftReport();return;}
  const emp=db.employees.find(e=>e.id===currentUser.employeeId)||db.employees.find(e=>e.name===currentUser.name);if(!emp)return alert('Karyawan tidak ditemukan.');
  const products=[...document.querySelectorAll('.shift-product')].map(row=>({name:row.querySelector('.sr-product-name')?.value.trim()||'',qty:Number(row.querySelector('.sr-product-qty')?.value||0),price:Number(row.querySelector('.sr-product-price')?.value||0)})).filter(x=>x.name||x.qty||x.price);
  const services=[...document.querySelectorAll('.sr-service-qty')].map(inp=>({serviceId:inp.dataset.service,serviceName:getService(inp.dataset.service)?.name||'Layanan',qty:Number(inp.value||0),price:Number(inp.dataset.price||0)})).filter(x=>x.qty>0);
  const stableShiftId='SHIFT'+Date.now();
  const payload={id:stableShiftId,date:document.getElementById('srDate')?.value||dateNow(),employeeId:emp.id,employeeName:emp.name,shiftType:document.getElementById('srShift')?.value||'Full Shift',customers:Number(document.getElementById('srCustomers')?.value||0),openingCash:Number(document.getElementById('srOpening')?.value||0),cash:Number(document.getElementById('srCash')?.value||0),qris:Number(document.getElementById('srQris')?.value||0),cashExpense:Number(document.getElementById('srExpense')?.value||0),physicalCash:Number(document.getElementById('srPhysical')?.value||0),totalPayment:c?.totalPayment||0,expectedCash:c?.expected||0,cashDifference:c?.difference||0,serviceTotal:c?.serviceTotal||0,productTotal:c?.productTotal||0,totalOmzet:c?.omzet||0,services,products,note:document.getElementById('srNote')?.value.trim()||'',savedAt:new Date().toISOString()};
  try{await api('shift-report',{method:'POST',body:JSON.stringify(payload)});
    const originalDate=window.__wzShiftStableId; window.__wzShiftStableId=stableShiftId;
    await localSaveShiftReport(); window.__wzShiftStableId=originalDate; syncBusiness();
  }catch(e){await localSaveShiftReport();toast('Laporan shift tersimpan lokal; server belum tersinkron: '+e.message);}
};

})();
</script>
