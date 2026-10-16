import {createAllTools} from './node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js';
import {createInterface} from 'node:readline';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const tools=createAllTools('/work');
for await (const line of createInterface({input:process.stdin})) {
 try {
  const {name,args}=JSON.parse(line);let result;
  if(name==='put_file'||name==='get_file') {
   const p=path.resolve('/work',args.path);
   if(!p.startsWith('/work/'))throw Error('File must be inside /work');
   // The entire filesystem is container-local, including symlink targets.
   if(name==='put_file'){await mkdir(path.dirname(p),{recursive:true});await writeFile(p,Buffer.from(args.data,'base64'));result={path:p};}
   else {const data=await readFile(p);if(data.length>20*1024*1024)throw Error('File exceeds 20 MB');result={data:data.toString('base64')};}
  } else {
   if(!['read','bash','write','edit','grep','find','ls'].includes(name))throw Error('Unknown Pi tool');
   if(name==='bash')args.timeout=Math.min(Math.max(args.timeout||60,1),60);
   result=await tools[name].execute('sandbox',args,AbortSignal.timeout(65000));
  }
  process.stdout.write(JSON.stringify({result})+'\n');
 }catch(e){process.stdout.write(JSON.stringify({error:String(e.message).slice(0,1000)})+'\n');}
}
