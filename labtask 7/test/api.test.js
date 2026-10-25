const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../app');
async function start(options) {
  const app=createApp(options);await new Promise(r=>app.listen(0,'127.0.0.1',r));
  return {close:()=>new Promise(r=>app.close(r)),request:async(method,url,body)=>{
    const res=await fetch(`http://127.0.0.1:${app.address().port}${url}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,body:res.status===204?undefined:await res.json()};
  }};
}
test('Part 1: CRUD for every module, validation, references and memory reset',async()=>{
  const s=await start({mode:'student'});const q=s.request;
  try {
    assert.equal((await q('POST','/students',null)).status,400);
    assert.equal((await q('POST','/students',{name:'Ali'})).status,400);
    const student={name:'Ali',rollNumber:'241851',email:'ali@example.com'};
    assert.equal((await q('POST','/students',student)).status,201);
    assert.equal((await q('POST','/students',student)).status,409);
    assert.equal((await q('POST','/teachers',{name:'Sara',email:'sara@example.com',subject:'CS301'})).status,201);
    assert.equal((await q('POST','/attendance',{studentId:1,teacherId:1,date:'2026-02-30',status:'present'})).status,400);
    const attendance={studentId:1,teacherId:1,date:'2026-10-25',status:'present'};
    assert.equal((await q('POST','/attendance',attendance)).status,201);
    assert.equal((await q('POST','/attendance',attendance)).status,409);
    const mark={studentId:1,teacherId:1,subject:'CS301',exam:'Lab 7',score:8,maxScore:10};
    assert.equal((await q('POST','/marks',{...mark,score:11})).status,400);
    assert.equal((await q('POST','/marks',mark)).status,201);
    assert.equal((await q('DELETE','/students/1')).status,409);
    for(const [resource,record] of Object.entries({attendance,marks:mark,students:student,teachers:{name:'Sara',email:'sara@example.com',subject:'CS301'}})) {
      assert.equal((await q('GET',`/${resource}/1`)).status,200);
      assert.equal((await q('PUT',`/${resource}/1`,record)).status,200);
      assert.equal((await q('PATCH',`/${resource}/1`,{})).status,200);
      assert.equal((await q('DELETE',`/${resource}/1`)).status,204);
      assert.equal((await q('GET',`/${resource}/1`)).status,404);
    }
    assert.equal((await q('POST','/students',{...student,rollNumber:'2'})).body.id,2);
  } finally {await s.close();}
  const fresh=await start({mode:'student'});
  try {assert.deepEqual((await fresh.request('GET','/students')).body,[]);}finally{await fresh.close();}
});
test('Part 2: persisted CRUD, atomic checkout, concurrent stock and restart',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lab7-'));const file=path.join(dir,'shop.json');
  let s=await start({mode:'shop',file});let q=s.request;
  try {
    assert.equal((await q('GET','/products')).body.length,8);
    assert.equal((await q('POST','/customers',{name:'Ali',email:'ali@example.com'})).status,201);
    assert.equal((await q('POST','/categories',{name:'Shoes'})).status,201);
    assert.equal((await q('POST','/products',{name:'Sneakers',price:3000,categoryId:6,stock:1})).status,201);
    assert.equal((await q('POST','/carts',{customerId:1,items:[{productId:9,quantity:1}]})).status,201);
    assert.equal((await q('POST','/reviews',{customerId:1,productId:9,rating:5,comment:'Great'})).status,201);
    assert.equal((await q('PATCH','/products/9',{price:3500})).status,200);
    const order={customerId:1,items:[{productId:9,quantity:1}],address:'Demo campus'};
    const results=await Promise.all([q('POST','/orders',order),q('POST','/orders',order)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    assert.equal(results.find(r=>r.status===201).body.total,3500);
    assert.equal((await q('GET','/carts')).body.length,0);
    assert.equal((await q('DELETE','/products/9')).status,409);
    assert.equal((await q('PATCH','/orders/1',{status:'paid'})).status,405);
    assert.equal((await q('GET','/api/products?categoryId=6')).body.length,1);
    for(const resource of ['reviews','customers','categories']) assert.equal((await q('GET',`/${resource}/1`)).status,200);
    assert.equal((await q('PUT','/reviews/1',{customerId:1,productId:9,rating:4,comment:'Updated'})).status,200);
    assert.equal((await q('DELETE','/reviews/1')).status,204);
    await s.close();s=await start({mode:'shop',file});q=s.request;
    assert.equal((await q('GET','/orders/1')).body.total,3500);
    assert.equal((await q('GET','/products/9')).body.stock,0);
    assert.equal((await q('GET','/customers/1')).body.name,'Ali');
    assert.equal((await q('POST','/categories',{name:'New'})).body.id,7);
    assert.equal((await q('DELETE','/categories/7')).status,204);
    assert.equal((await q('POST','/categories',{name:'Next'})).body.id,8);
  }finally{await s.close();await fs.rm(dir,{recursive:true,force:true});}
});
