import{j as a}from"./vendor-motion-mb8w6MQI.js";import{a as s}from"./vendor-redux-DvxbXa60.js";import{e as C}from"./index-D_1uFbhm.js";import"./vendor-react-Bp4g4aIW.js";import"./vendor-axios-C0Zqfgkc.js";function O(){const[m,_]=s.useState([]),[l,$]=s.useState(null),[g,S]=s.useState([]),[u,y]=s.useState([]),[D,p]=s.useState(!0),w=()=>{const t=new Date;return`${t.getFullYear()}-${(t.getMonth()+1).toString().padStart(2,"0")}-${t.getDate().toString().padStart(2,"0")}`},[d,b]=s.useState(w()),[r,j]=s.useState(null),x=async t=>{try{p(!0);const n=(await C.batchStatus({project_id:16,date:t})).data;j(n);const o=n.total_orders?.plans||0,i=n.total_orders?.done||0,c=n.total_orders?.pending||0,v=n.total_orders?.sent_to_fixing||0;_(n.batches||[]),$({total_batches:n.batches?.length||0,total_plans:o,total_done:i,total_pending:c,total_fixing:v}),S(n.plans_remaining||[]),y(n.hourly_counts||[])}catch(e){console.error("Batch Status Error:",e)}finally{p(!1)}};s.useEffect(()=>{x(d)},[]);const f=t=>{if(t){const[n,o,i]=t.split("-");if(n&&o&&i)return`${i}-${o}-${n}`}const e=new Date;return`${e.getDate().toString().padStart(2,"0")}-${(e.getMonth()+1).toString().padStart(2,"0")}-${e.getFullYear()}`},h=()=>{if(!m.length)return"";let t="";return t+=`Cubi 2D
`,t+=`${f(d)}

`,m.forEach(e=>{t+=`Batch ${e.batch_no}
`,t+=`Received Time: ${e.received_time}
`;let n=e.remaining_time;if(n&&n.includes("-")){const[o,i]=n.split("-").map(c=>c.trim());o===i&&(n=o)}t+=`Remaining Time: ${n}
`,t+=`Plans: ${e.plans}
`,t+=`Done: ${e.done}
`,e.pending>0&&(t+=`Pending: ${e.pending}
`),e.fixing>0&&(t+=`Sent to Fixing: ${e.fixing}
`),t+=`
`}),t+=`Total Orders:
`,t+=`Plans: ${l?.total_plans||0}
`,t+=`Done: ${l?.total_done||0}
`,t+=`Pending: ${l?.total_pending||0}

`,t+=`Drawing Process : ${r?.total_orders?.drawing_process||0}
`,t+=`Untouched Orders : ${r?.total_orders?.untouched_orders||0}
`,t+=`Sent to Fixing : ${l?.total_fixing||0}

`,g.length&&(t+=`Plans Remaining Time

`,g.forEach(e=>{t+=`${e.plans} Plans : ${e.hour}h
`}),t+=`
`),u.length&&(t+=`Hourly Counts

`,u.forEach(e=>{t+=`${e.label} - ${e.orders} Orders
`}),t+=`
`),r?.untouched_min?.remaining_time&&(t+=`Untouched Top plan
`,t+=`Least Remaining Time: ${r.untouched_min.remaining_time}

`),r?.fixed_min?.remaining_time&&(t+=`Fixed Order Top plan
`,t+=`Least Remaining Time: ${r.fixed_min.remaining_time}
`),t},R=()=>{const t=h();navigator.clipboard.writeText(t),alert("Copied Correct Format ✅")},T=f(d);return a.jsxs("div",{className:"max-w-md mx-auto bg-gray-50 min-h-screen p-4 space-y-4 font-sans",children:[a.jsxs("div",{className:"text-center mb-4",children:[a.jsx("h1",{className:"text-2xl font-bold text-slate-800",children:"Cubi 2D"}),a.jsx("p",{className:"text-sm text-slate-500",children:T}),a.jsxs("div",{className:"flex justify-between mt-3 gap-2",children:[a.jsx("input",{type:"date",value:d,className:"border px-3 py-2 rounded text-sm w-full bg-white",onChange:t=>{b(t.target.value),x(t.target.value)}}),a.jsx("button",{onClick:R,className:"bg-blue-600 text-white px-4 py-2 rounded text-sm",children:"Copy Report"})]})]}),D?a.jsx("div",{className:"text-center text-gray-500",children:"Loading..."}):a.jsx("pre",{className:"bg-black text-green-400 p-4 rounded text-xs whitespace-pre-wrap",children:h()})]})}export{O as default};
