const { Pool } = require('pg');
const crypto = require('crypto');

let pool;
function getPool(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum dikonfigurasi di Vercel.');
  if(!pool) pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});
  return pool;
}

function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.scryptSync(String(password),salt,64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored){
  try{
    const [salt,hex]=String(stored).split(':');
    const a=Buffer.from(hex,'hex');
    const b=crypto.scryptSync(String(password),salt,64);
    return a.length===b.length && crypto.timingSafeEqual(a,b);
  }catch{return false}
}
function token(){return crypto.randomBytes(32).toString('hex')}
function tokenHash(t){return crypto.createHash('sha256').update(t).digest('hex')}
function defaultUsername(name){return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'')||'employee'}
function defaultPassword(name){return String(name||'').trim().toLowerCase().replace(/\s+/g,'')+'123'}

let schemaPromise;
async function schema(){
  const p=getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS wz_branches(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS wz_employees(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'Barber',branch_id TEXT REFERENCES wz_branches(id),
      salary NUMERIC NOT NULL DEFAULT 0,commission NUMERIC NOT NULL DEFAULT 0,target NUMERIC NOT NULL DEFAULT 0,
      attendance NUMERIC NOT NULL DEFAULT 0,eval NUMERIC NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wz_users(
      id BIGSERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,
      name TEXT NOT NULL,employee_id TEXT UNIQUE REFERENCES wz_employees(id) ON DELETE SET NULL,active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wz_sessions(
      token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES wz_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_sessions_exp_idx ON wz_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS wz_transactions(
      id TEXT PRIMARY KEY,date DATE NOT NULL,customer_id TEXT,customer_name TEXT,service_id TEXT,service_name TEXT,
      service_price NUMERIC NOT NULL DEFAULT 0,employee_id TEXT,employee_name TEXT,total NUMERIC NOT NULL DEFAULT 0,
      payment TEXT NOT NULL,status TEXT NOT NULL,discount NUMERIC NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_transactions_date_idx ON wz_transactions(date);
    CREATE INDEX IF NOT EXISTS wz_transactions_employee_idx ON wz_transactions(employee_id);
    CREATE TABLE IF NOT EXISTS wz_shift_reports(
      id TEXT PRIMARY KEY,date DATE NOT NULL,employee_id TEXT,employee_name TEXT,shift_type TEXT,customers INTEGER NOT NULL DEFAULT 0,
      opening_cash NUMERIC NOT NULL DEFAULT 0,cash NUMERIC NOT NULL DEFAULT 0,qris NUMERIC NOT NULL DEFAULT 0,cash_expense NUMERIC NOT NULL DEFAULT 0,
      physical_cash NUMERIC NOT NULL DEFAULT 0,total_payment NUMERIC NOT NULL DEFAULT 0,expected_cash NUMERIC NOT NULL DEFAULT 0,cash_difference NUMERIC NOT NULL DEFAULT 0,
      service_total NUMERIC NOT NULL DEFAULT 0,product_total NUMERIC NOT NULL DEFAULT 0,total_omzet NUMERIC NOT NULL DEFAULT 0,
      services JSONB NOT NULL DEFAULT '[]'::jsonb,products JSONB NOT NULL DEFAULT '[]'::jsonb,note TEXT,saved_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wz_shift_reports_date_idx ON wz_shift_reports(date);
    CREATE INDEX IF NOT EXISTS wz_shift_reports_employee_idx ON wz_shift_reports(employee_id);
  `);
  await p.query(`
    INSERT INTO wz_branches(id,name,active) VALUES
    ('B001','WZBARBERSHOP MASBAGIK',true),('B002','WZBARBERSHOP MONJOK',true),
    ('B003','WZBARBERSHOP GUNUNGSARI',true),('B004','WZBARBERSHOP KURANJI',true),
    ('B005','WZBARBERSHOP LEMBAR',true)
    ON CONFLICT (id) DO NOTHING;
  `);
  const employees=[
    ['E001','Rizky','B001'],['E002','ALVIN','B002'],['E003','KYONG','B003'],['E004','IWAN','B004'],['E005','DIKA','B005']
  ];
  for(const [id,name,branch] of employees){
    await p.query(`INSERT INTO wz_employees(id,name,role,branch_id,salary,active) VALUES($1,$2,'Barber',$3,2000000,true) ON CONFLICT(id) DO NOTHING`,[id,name,branch]);
    const username=defaultUsername(name), password=defaultPassword(name);
    await p.query(`INSERT INTO wz_users(username,password_hash,role,name,employee_id) VALUES($1,$2,'employee',$3,$4) ON CONFLICT(username) DO NOTHING`,[username,hashPassword(password),name,id]);
  }
  for(const [username,password,name,role] of [['owner','owner123','OWNER','owner'],['manager','manager123','MANAGER','manager']]){
    const exists=await p.query('SELECT id FROM wz_users WHERE username=$1',[username]);
    if(!exists.rowCount) await p.query('INSERT INTO wz_users(username,password_hash,role,name) VALUES($1,$2,$3,$4)',[username,hashPassword(password),role,name]);
  }
}

async function ensureSchema(){ if(!schemaPromise) schemaPromise=schema().catch(e=>{schemaPromise=null;throw e}); return schemaPromise; }

async function authUser(req){
  const cookie=String(req.headers.cookie||'');
  const m=cookie.match(/(?:^|;\s*)wz_session=([^;]+)/); if(!m)return null;
  const p=getPool();
  const r=await p.query(`SELECT u.id,u.username,u.role,u.name,u.employee_id,e.branch_id FROM wz_sessions s JOIN wz_users u ON u.id=s.user_id LEFT JOIN wz_employees e ON e.id=u.employee_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=true`,[tokenHash(decodeURIComponent(m[1]))]);
  return r.rows[0]||null;
}
function cookie(name,value,maxAge){return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`}
function send(res,status,data,headers={}){res.statusCode=status;for(const [k,v] of Object.entries(headers))res.setHeader(k,v);res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
async function body(req){let s='';for await(const c of req)s+=c;return s?JSON.parse(s):{};}
async function employeeFor(id){
  if(!id)return null;
  const r=await getPool().query('SELECT id,name,branch_id AS "branchId",active FROM wz_employees WHERE id=$1',[String(id)]);
  return r.rows[0]||null;
}
function validMoney(n){return Number.isFinite(Number(n))&&Number(n)>=0;}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''));}
function validTransaction(t){
  const servicePrice=Number(t.servicePrice||0),discount=Number(t.discount||0),total=Number(t.total||0);
  return validDate(t.date)&&validMoney(servicePrice)&&validMoney(discount)&&validMoney(total)&&discount<=servicePrice&&Math.abs(total-Math.max(0,servicePrice-discount))<=0.001&&['SELESAI','VOID'].includes(String(t.status||'SELESAI'))&&['Tunai','QRIS','Transfer'].includes(String(t.payment||'Tunai'));
}
function validShift(r){
  const values=['openingCash','cash','qris','cashExpense','physicalCash','totalPayment','expectedCash','cashDifference','serviceTotal','productTotal','totalOmzet'];
  return validDate(r.date)&&values.every(key=>validMoney(r[key]))&&Math.abs(Number(r.cashDifference||0))<=0.001&&Math.abs(Number(r.physicalCash||0)-(Number(r.openingCash||0)+Number(r.cash||0)-Number(r.cashExpense||0)))<=0.001;
}

async function handler(req,res){
  try{
    await ensureSchema();
    const path=req.url.split('?')[0].replace(/^\/api\/?/,'').replace(/\/$/,'');
    if(path==='ready')return send(res,200,{ok:true,service:'WZ MANAGE PRO API',database:true});
    if(path==='auth/login' && req.method==='POST'){
      const b=await body(req),username=String(b.username||'').trim(),password=String(b.password||'');
      if(!username||!password)return send(res,400,{ok:false,error:'Username dan password wajib diisi.'});
      const p=getPool(),r=await p.query('SELECT u.*,e.branch_id FROM wz_users u LEFT JOIN wz_employees e ON e.id=u.employee_id WHERE u.username=$1 AND u.active=true',[username]),u=r.rows[0];
      if(!u||!verifyPassword(password,u.password_hash))return send(res,401,{ok:false,error:'Username atau password salah.'});
      const t=token(); await p.query('DELETE FROM wz_sessions WHERE expires_at<=NOW()');
      await p.query('INSERT INTO wz_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'30 days\')',[tokenHash(t),u.id]);
      return send(res,200,{ok:true,user:{username:u.username,role:u.role,name:u.name,employeeId:u.employee_id||null,branchId:u.branch_id||null}}, {'Set-Cookie':cookie('wz_session',t,60*60*24*30)});
    }
    if(path==='auth/me' && req.method==='GET'){
      const u=await authUser(req); if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      return send(res,200,{ok:true,user:{username:u.username,role:u.role,name:u.name,employeeId:u.employee_id||null,branchId:u.branch_id||null}});
    }
    if(path==='auth/logout' && req.method==='POST'){
      const c=String(req.headers.cookie||''),m=c.match(/(?:^|;\s*)wz_session=([^;]+)/);if(m)await getPool().query('DELETE FROM wz_sessions WHERE token_hash=$1',[tokenHash(decodeURIComponent(m[1]))]);
      return send(res,200,{ok:true},{'Set-Cookie':cookie('wz_session','',0)});
    }
    if(path==='business' && req.method==='GET'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const p=getPool();
      const txSql='SELECT id,date,customer_id AS "customerId",customer_name AS "customerName",service_id AS "serviceId",service_name AS "serviceName",service_price AS "servicePrice",employee_id AS "employeeId",employee_name AS "employeeName",total,payment,status,discount,updated_at AS "updatedAt" FROM wz_transactions '+(u.role==='employee'?'WHERE employee_id=$1 ':'')+'ORDER BY date,id';
      const shSql='SELECT id,date,employee_id AS "employeeId",employee_name AS "employeeName",shift_type AS "shiftType",customers,opening_cash AS "openingCash",cash,qris,cash_expense AS "cashExpense",physical_cash AS "physicalCash",total_payment AS "totalPayment",expected_cash AS "expectedCash",cash_difference AS "cashDifference",service_total AS "serviceTotal",product_total AS "productTotal",total_omzet AS "totalOmzet",services,products,note,saved_at AS "savedAt",updated_at AS "updatedAt" FROM wz_shift_reports '+(u.role==='employee'?'WHERE employee_id=$1 ':'')+'ORDER BY date,id';
      const params=u.role==='employee'?[u.employee_id]:[];
      const tx=await p.query(txSql,params);
      const sh=await p.query(shSql,params);
      return send(res,200,{ok:true,transactions:tx.rows,shiftReports:sh.rows});
    }
    if(path==='sync-business' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const b=await body(req),txs=Array.isArray(b.transactions)?b.transactions:[],shifts=Array.isArray(b.shiftReports)?b.shiftReports:[];
      if(u.role==='employee'){
        if(!u.employee_id)return send(res,403,{ok:false,error:'Akun karyawan tidak terhubung ke ID karyawan.'});
        if(txs.some(t=>String(t.employeeId)!==String(u.employee_id)))return send(res,403,{ok:false,error:'Karyawan hanya boleh sinkronkan transaksi miliknya.'});
        if(shifts.some(r=>String(r.employeeId)!==String(u.employee_id)))return send(res,403,{ok:false,error:'Karyawan hanya boleh sinkronkan laporan shift miliknya.'});
      }
      if(txs.some(t=>!t.id||!t.employeeId||!validTransaction(t)))return send(res,400,{ok:false,error:'Data transaksi tidak valid.'});
      if(shifts.some(r=>!r.id||!r.employeeId||!validShift(r)))return send(res,400,{ok:false,error:'Data laporan shift tidak valid.'});
      const employeeIds=[...new Set([...txs.map(t=>t.employeeId),...shifts.map(r=>r.employeeId)].filter(Boolean).map(String))];
      if(employeeIds.length){
        const er=await getPool().query('SELECT id,active FROM wz_employees WHERE id = ANY($1::text[])',[employeeIds]);
        const valid=new Map(er.rows.map(x=>[String(x.id),x]));
        for(const id of employeeIds){if(!valid.has(id))return send(res,400,{ok:false,error:'ID karyawan tidak terdaftar: '+id});}
        if(txs.some(t=>t.employeeId&&valid.get(String(t.employeeId))?.active===false)||shifts.some(r=>r.employeeId&&valid.get(String(r.employeeId))?.active===false))return send(res,400,{ok:false,error:'Karyawan nonaktif tidak dapat menyimpan data baru.'});
      }
      const client=await getPool().connect();
      try{
        await client.query('BEGIN');
        for(const t of txs){
          await client.query(`INSERT INTO wz_transactions(id,date,customer_id,customer_name,service_id,service_name,service_price,employee_id,employee_name,total,payment,status,discount,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) ON CONFLICT(id) DO UPDATE SET date=EXCLUDED.date,customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,service_id=EXCLUDED.service_id,service_name=EXCLUDED.service_name,service_price=EXCLUDED.service_price,employee_id=EXCLUDED.employee_id,employee_name=EXCLUDED.employee_name,total=EXCLUDED.total,payment=EXCLUDED.payment,status=EXCLUDED.status,discount=EXCLUDED.discount,updated_at=NOW()`,[t.id,t.date,t.customerId||null,t.customerName||null,t.serviceId||null,t.serviceName||null,Number(t.servicePrice||0),t.employeeId||null,t.employeeName||null,Number(t.total||0),t.payment||'Tunai',t.status||'SELESAI',Number(t.discount||0)]);
        }
        for(const r of shifts){
          await client.query(`INSERT INTO wz_shift_reports(id,date,employee_id,employee_name,shift_type,customers,opening_cash,cash,qris,cash_expense,physical_cash,total_payment,expected_cash,cash_difference,service_total,product_total,total_omzet,services,products,note,saved_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,NOW()) ON CONFLICT(id) DO UPDATE SET date=EXCLUDED.date,employee_id=EXCLUDED.employee_id,employee_name=EXCLUDED.employee_name,shift_type=EXCLUDED.shift_type,customers=EXCLUDED.customers,opening_cash=EXCLUDED.opening_cash,cash=EXCLUDED.cash,qris=EXCLUDED.qris,cash_expense=EXCLUDED.cash_expense,physical_cash=EXCLUDED.physical_cash,total_payment=EXCLUDED.total_payment,expected_cash=EXCLUDED.expected_cash,cash_difference=EXCLUDED.cash_difference,service_total=EXCLUDED.service_total,product_total=EXCLUDED.product_total,total_omzet=EXCLUDED.total_omzet,services=EXCLUDED.services,products=EXCLUDED.products,note=EXCLUDED.note,saved_at=EXCLUDED.saved_at,updated_at=NOW()`,[r.id,r.date,r.employeeId||null,r.employeeName||null,r.shiftType||null,Number(r.customers||0),Number(r.openingCash||0),Number(r.cash||0),Number(r.qris||0),Number(r.cashExpense||0),Number(r.physicalCash||0),Number(r.totalPayment||0),Number(r.expectedCash||0),Number(r.cashDifference||0),Number(r.serviceTotal||0),Number(r.productTotal||0),Number(r.totalOmzet||0),JSON.stringify(r.services||[]),JSON.stringify(r.products||[]),r.note||null,r.savedAt||null]);
        }
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
      return send(res,200,{ok:true,transactions:txs.length,shiftReports:shifts.length});
    }
    if(path==='transaction' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});
      const t=await body(req);if(!t.id||!t.date||!t.employeeId)return send(res,400,{ok:false,error:'Data transaksi tidak lengkap.'});
      if(!validTransaction(t))return send(res,400,{ok:false,error:'Nilai transaksi tidak valid.'});
      if(u.role==='employee'&&String(t.employeeId)!==String(u.employee_id))return send(res,403,{ok:false,error:'Karyawan hanya boleh membuat transaksi atas namanya sendiri.'});
      const te=await employeeFor(t.employeeId);if(!te)return send(res,400,{ok:false,error:'Karyawan tidak terdaftar.'});
      if(te.active===false)return send(res,400,{ok:false,error:'Karyawan sudah nonaktif.'});
      const servicePrice=Number(t.servicePrice||0),discount=Number(t.discount||0),total=Number(t.total||0);
      const c=await getPool().connect();try{await c.query('BEGIN');await c.query(`INSERT INTO wz_transactions(id,date,customer_id,customer_name,service_id,service_name,service_price,employee_id,employee_name,total,payment,status,discount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,total=EXCLUDED.total,updated_at=NOW()`,[t.id,t.date,t.customerId||null,t.customerName||null,t.serviceId||null,t.serviceName||null,servicePrice,t.employeeId,te.name,total,t.payment||'Tunai',t.status||'SELESAI',discount]);await c.query('COMMIT');return send(res,200,{ok:true,id:t.id});}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    }
    if(path==='transaction/void' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});const b=await body(req);const r=await getPool().query("UPDATE wz_transactions SET status='VOID',updated_at=NOW() WHERE id=$1 AND ($2<>'employee' OR employee_id=$3) RETURNING id",[b.id,u.role,u.employee_id]);if(!r.rowCount)return send(res,404,{ok:false,error:'Transaksi tidak ditemukan atau tidak boleh diubah.'});return send(res,200,{ok:true});
    }
    if(path==='shift-report' && req.method==='POST'){
      const u=await authUser(req);if(!u)return send(res,401,{ok:false,error:'Belum login.'});const r=await body(req);if(!r.id||!r.date||!r.employeeId)return send(res,400,{ok:false,error:'Data shift tidak lengkap.'});if(u.role==='employee'&&String(r.employeeId)!==String(u.employee_id))return send(res,403,{ok:false,error:'Karyawan hanya boleh menyimpan shift miliknya.'});const re=await employeeFor(r.employeeId);if(!re)return send(res,400,{ok:false,error:'Karyawan tidak terdaftar.'});if(re.active===false)return send(res,400,{ok:false,error:'Karyawan sudah nonaktif.'});const cash=Number(r.cash||0),qris=Number(r.qris||0),opening=Number(r.openingCash||0),expense=Number(r.cashExpense||0),physical=Number(r.physicalCash||0);if([cash,qris,opening,expense,physical].some(n=>!validMoney(n)))return send(res,400,{ok:false,error:'Nilai kas shift tidak valid.'});const expected=opening+cash-expense,difference=physical-expected;if(Math.abs(difference)>0.001)return send(res,400,{ok:false,error:'Selisih kasir harus Rp 0.'});
      await getPool().query(`INSERT INTO wz_shift_reports(id,date,employee_id,employee_name,shift_type,customers,opening_cash,cash,qris,cash_expense,physical_cash,total_payment,expected_cash,cash_difference,service_total,product_total,total_omzet,services,products,note,saved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21) ON CONFLICT(id) DO UPDATE SET customers=EXCLUDED.customers,opening_cash=EXCLUDED.opening_cash,cash=EXCLUDED.cash,qris=EXCLUDED.qris,cash_expense=EXCLUDED.cash_expense,physical_cash=EXCLUDED.physical_cash,total_payment=EXCLUDED.total_payment,expected_cash=EXCLUDED.expected_cash,cash_difference=EXCLUDED.cash_difference,service_total=EXCLUDED.service_total,product_total=EXCLUDED.product_total,total_omzet=EXCLUDED.total_omzet,services=EXCLUDED.services,products=EXCLUDED.products,note=EXCLUDED.note,saved_at=EXCLUDED.saved_at,updated_at=NOW()`,[r.id,r.date,r.employeeId,r.employeeName||u.name,r.shiftType||null,Number(r.customers||0),Number(r.openingCash||0),Number(r.cash||0),Number(r.qris||0),Number(r.cashExpense||0),Number(r.physicalCash||0),Number(r.totalPayment||0),Number(r.expectedCash||0),Number(r.cashDifference||0),Number(r.serviceTotal||0),Number(r.productTotal||0),Number(r.totalOmzet||0),JSON.stringify(r.services||[]),JSON.stringify(r.products||[]),r.note||null,r.savedAt||new Date().toISOString()]);
      return send(res,200,{ok:true,id:r.id});
    }
    if(path==='employees' && req.method==='GET'){
      const u=await authUser(req);if(!u||!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Akses ditolak.'});
      const r=await getPool().query(`SELECT e.id,e.name,e.role,e.branch_id AS "branchId",e.salary,e.commission,e.target,e.attendance,e.eval,e.active FROM wz_employees e ORDER BY e.id`);
      return send(res,200,{ok:true,employees:r.rows});
    }
    if(path==='employees' && (req.method==='POST'||req.method==='PUT')){
      const u=await authUser(req);if(!u||!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Hanya Owner/Manager yang dapat mengelola karyawan.'});
      const b=await body(req);const p=getPool();
      const name=String(b.name||'').trim(),branchId=String(b.branchId||'').trim(),password=String(b.password||'').trim();
      if(!name)return send(res,400,{ok:false,error:'Nama karyawan wajib diisi.'});
      if(!branchId)return send(res,400,{ok:false,error:'Cabang wajib dipilih.'});
      if(!password)return send(res,400,{ok:false,error:'Password login wajib diisi.'});
      const id=String(b.id||'').trim() || `E${String((await p.query("SELECT COALESCE(MAX(CAST(SUBSTRING(id,2) AS INTEGER)),0)+1 n FROM wz_employees WHERE id LIKE 'E%'")).rows[0].n).padStart(3,'0')}`;
      const role=String(b.role||'Barber'),salary=Number(b.salary)||0,target=Number(b.target)||0,username=String(b.username||defaultUsername(name)).trim();
      const client=await p.connect();
      try{
        await client.query('BEGIN');
        await client.query(`INSERT INTO wz_employees(id,name,role,branch_id,salary,commission,target,active,updated_at) VALUES($1,$2,$3,$4,$5,0,$6,true,NOW()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,branch_id=EXCLUDED.branch_id,salary=EXCLUDED.salary,target=EXCLUDED.target,updated_at=NOW()`,[id,name,role,branchId,salary,target]);
        const existing=await client.query('SELECT id FROM wz_users WHERE employee_id=$1',[id]);
        const ph=hashPassword(password);
        if(existing.rowCount) await client.query('UPDATE wz_users SET username=$1,password_hash=$2,name=$3,role=\'employee\',active=true,updated_at=NOW() WHERE employee_id=$4',[username,ph,name,id]);
        else await client.query('INSERT INTO wz_users(username,password_hash,role,name,employee_id) VALUES($1,$2,\'employee\',$3,$4)',[username,ph,name,id]);
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
      const r=await p.query(`SELECT id,name,role,branch_id AS "branchId",salary,commission,target,attendance,eval,active FROM wz_employees WHERE id=$1`,[id]);
      return send(res,200,{ok:true,employee:r.rows[0],username});
    }
    if(path==='employees' && req.method==='DELETE'){
      const u=await authUser(req);if(!u||!['owner','manager'].includes(u.role))return send(res,403,{ok:false,error:'Akses ditolak.'});
      const id=new URL(req.url,'http://localhost').searchParams.get('id');if(!id)return send(res,400,{ok:false,error:'ID karyawan wajib diisi.'});
      const client=await getPool().connect();try{await client.query('BEGIN');await client.query('DELETE FROM wz_users WHERE employee_id=$1',[id]);const r=await client.query('DELETE FROM wz_employees WHERE id=$1 RETURNING id',[id]);if(!r.rowCount){await client.query('ROLLBACK');return send(res,404,{ok:false,error:'Karyawan tidak ditemukan.'});}await client.query('COMMIT');return send(res,200,{ok:true});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()};
    }
    return send(res,404,{ok:false,error:'Endpoint tidak ditemukan.'});
  }catch(e){console.error(e);return send(res,500,{ok:false,error:e.message||'Server error'});}
}
module.exports=handler;
