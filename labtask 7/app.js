// Extends Week 7's memory HTTP API and queued JSON-file store. No dependencies.
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./store');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const nonnegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const names = ['Oversized Hoodie','Relaxed Cargo Pants','Heavyweight Ecru Tee','Chocolate Rib Baby Tee','Straight Leg Denim','Studio Bomber Jacket','Matte Puffer Vest','Washed Olive Cap'];
const prices = [4500,5200,2200,1800,5800,8900,6400,1500];
function shopSeed() {
  return { categories: ['Hoodies','Bottoms','Tees','Jackets','Accessories'].map((name,i) => ({ id:i+1,name })),
    products: names.map((name,i) => ({ id:i+1,name,price:prices[i],categoryId:[1,2,3,3,2,4,4,5][i],stock:20 })), customers:[],carts:[],orders:[],reviews:[] };
}
function validate(resource, b, db, existingId) {
  b=Object.fromEntries(Object.entries(b).map(([k,v]) => [k,typeof v==='string'?v.trim():v]));
  const fields = {
    students: { name:text,rollNumber:text,email:text }, teachers:{ name:text,email:text,subject:text },
    attendance:{ studentId:positive,teacherId:positive,date:v => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,status:v => ['present','absent','late','excused'].includes(v) },
    marks:{ studentId:positive,teacherId:positive,subject:text,exam:text,score:nonnegative,maxScore:v => nonnegative(v)&&v>0 },
    categories:{ name:text },products:{ name:text,price:nonnegative,categoryId:positive,stock:v => Number.isSafeInteger(v)&&v>=0 },
    customers:{ name:text,email:text },carts:{ customerId:positive,items:Array.isArray },
    reviews:{ customerId:positive,productId:positive,rating:v => positive(v)&&v<=5,comment:text },
    orders:{ customerId:positive,items:v => Array.isArray(v)&&v.length>0,address:text }
  }[resource];
  for (const [key, check] of Object.entries(fields)) if (!check(b[key])) fail(400,`Invalid or missing ${key}`);
  for (const key of Object.keys(b)) if (!(key in fields)) fail(400,`Unknown field: ${key}`);
  if ('email' in b && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) fail(400,'Invalid email');
  for (const key of ['email','rollNumber']) if (b[key] && db[resource].some(r => r.id!==existingId && r[key]?.toLowerCase()===b[key].toLowerCase())) fail(409,`${key} already exists`);
  for (const [key, table] of Object.entries({studentId:'students',teacherId:'teachers',categoryId:'categories',customerId:'customers',productId:'products'})) {
    if (key in b && !db[table].some(r => r.id===b[key])) fail(400,`${key} does not exist`);
  }
  if(resource==='marks' && b.score>b.maxScore) fail(400,'score cannot exceed maxScore');
  if(resource==='attendance' && db.attendance.some(r => r.id!==existingId && r.studentId===b.studentId && r.teacherId===b.teacherId && r.date===b.date)) fail(409,'Attendance already recorded');
  if(resource==='carts' && db.carts.some(r => r.id!==existingId && r.customerId===b.customerId)) fail(409,'Customer already has a cart');
  if(b.items) {
    const ids = new Set();
    for(const item of b.items) {
      if(!item || !positive(item.productId) || !positive(item.quantity) || Object.keys(item).some(k => !['productId','quantity'].includes(k))) fail(400,'Items require productId and positive integer quantity');
      if(ids.has(item.productId)) fail(400,'Duplicate product in items');
      ids.add(item.productId);
      const product=db.products.find(p => p.id===item.productId);
      if(!product) fail(400,'Product does not exist');
      if(item.quantity>product.stock) fail(409,'Insufficient stock');
    }
  }
  return Object.fromEntries(Object.entries(b).map(([k,v]) => [k,typeof v==='string'?v.trim():v]));
}
function createApp({ mode='student', file=path.join(__dirname,'data','shop.json') }={}) {
  const memory = {students:[],teachers:[],attendance:[],marks:[],_next:{}};
  const disk=createStore(file);
  // Store one database object inside the supplied starter's array-based store.
  const edit = change => mode==='student' ? Promise.resolve().then(()=>change(memory)) : disk.edit(rows => {
    if(!rows.length) rows.push({...shopSeed(),_next:{}});
    return {changed:true,value:change(rows[0])};
  });
  const read = async () => mode==='student'?memory:(await disk.list())[0] || {...shopSeed(),_next:{}};
  const resources=mode==='student'?['students','teachers','attendance','marks']:['categories','products','customers','carts','orders','reviews'];
  return http.createServer(async(req,res) => {
    const send=(status,body) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(body===undefined?undefined:JSON.stringify(body)); };
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/' && req.method==='GET') return send(200,{mode,resources});
      const parts=url.pathname.replace(/^\/api(?=\/)/,'').split('/').filter(Boolean);
      const [resource,rawId]=parts;
      if(parts.length>2 || !resources.includes(resource)) fail(404,'Not found');
      const id=rawId===undefined?undefined:Number(rawId);
      if(rawId!==undefined && (!/^\d+$/.test(rawId)||!positive(id))) fail(400,'Invalid id');
      if(req.method==='GET') {
        let rows=(await read())[resource];
        if(id!==undefined) return send(200,rows.find(r=>r.id===id)||fail(404,'Not found'));
        for(const [key,value] of url.searchParams) {
          if(!['studentId','teacherId','customerId','productId','categoryId','status','date'].includes(key)) fail(400,'Unsupported filter');
          rows=rows.filter(r=>String(r[key])===value);
        }
        return send(200,rows);
      }
      if(!['POST','PUT','PATCH','DELETE'].includes(req.method)) { res.setHeader('Allow','GET, POST, PUT, PATCH, DELETE'); fail(405,'Method not allowed'); }
      if((req.method==='POST')!==(id===undefined)) fail(405,'POST requires collection; edits require id');
      let body;
      if(req.method!=='DELETE') {
        const chunks=[]; let size=0;
        for await(const chunk of req) { size+=chunk.length;if(size>65536) fail(413,'Body too large');chunks.push(chunk); }
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) fail(415,'Use application/json');
        try { body=JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400,'Invalid JSON'); }
        if(!body || typeof body!=='object' || Array.isArray(body)) fail(400,'Body must be an object');
      }
      const result=await edit(db => {
        const rows=db[resource];const index=rows.findIndex(r=>r.id===id);
        if(id!==undefined && index<0) fail(404,'Not found');
        if(resource==='orders' && req.method!=='POST') fail(405,'Orders are immutable');
        if(req.method==='DELETE') {
          const foreign={students:'studentId',teachers:'teacherId',categories:'categoryId',customers:'customerId',products:'productId'}[resource];
          if(foreign && Object.values(db).some(table=>Array.isArray(table)&&table.some(r=>r[foreign]===id || (foreign==='productId' && r.items?.some(item=>item.productId===id))))) fail(409,'Record is referenced; remove related records first');
          rows.splice(index,1);return;
        }
        let candidate=body;
        if(req.method==='PATCH') { const {id:ignored,...old}=rows[index];candidate={...old,...body}; }
        const clean=validate(resource,candidate,db,id);
        if(resource==='orders') {
          clean.items=clean.items.map(item=>{const p=db.products.find(p=>p.id===item.productId);p.stock-=item.quantity;return {...item,name:p.name,unitPrice:p.price};});
          clean.total=clean.items.reduce((sum,item)=>sum+Math.round(item.unitPrice*100)*item.quantity,0)/100;
          clean.status='placed';clean.createdAt=new Date().toISOString();
          db.carts=db.carts.filter(c=>c.customerId!==clean.customerId);
        }
        if(req.method==='POST') {
          db._next[resource]=Math.max(db._next[resource]||1,...rows.map(r=>r.id+1));
          const record={id:db._next[resource]++,...clean};rows.push(record);return record;
        }
        rows[index]={id,...clean};return rows[index];
      });
      send(req.method==='POST'?201:req.method==='DELETE'?204:200,result);
    } catch(error) { if(!error.status) console.error(error);send(error.status||500,{error:error.status?error.message:'Server error'}); }
  });
}
module.exports={createApp};
