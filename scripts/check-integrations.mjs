const services=[
 ['Darkbloom',process.env.DARKBLOOM_BASE_URL+'/models',{'Authorization':`Bearer ${process.env.DARKBLOOM_API_KEY}`}],
 ['SIE',process.env.SIE_BASE_URL+'/v1/models',{'Authorization':`Bearer ${process.env.SIE_API_KEY}`}],
 ['Cognee',process.env.COGNEE_BASE_URL+'/health',{'X-Api-Key':process.env.COGNEE_API_KEY}],
];
await Promise.all(services.map(async([name,url,headers])=>{try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(20000),redirect:'error'});const body=await r.json().catch(()=>null);console.log(name,r.status,body?.data?.map(m=>m.id)??body?.models??(body?Object.keys(body):'non-JSON'));}catch(e){console.log(name,'unreachable',e.cause?.code??e.name)}}));
