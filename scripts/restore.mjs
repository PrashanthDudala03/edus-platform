import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
const args=process.argv.slice(2),source=args[0]
if(!source)throw Error('Usage: node scripts/restore.mjs <backup-directory> [--apply --confirm <database-name>]. Default: isolated restore rehearsal.')
const folder=path.resolve(source),manifest=JSON.parse(readFileSync(path.join(folder,'manifest.json'),'utf8'))
if(manifest.format!==1)throw Error('Unsupported backup format.')
for(const name of ['database.dump','documents.tar.gz']){
 const hash=createHash('sha256').update(readFileSync(path.join(folder,name))).digest('hex')
 if(manifest.files[name]!==hash)throw Error('Backup integrity check failed: '+name)
}
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const docker=(args,quiet=false)=>execFileSync('docker',args,{cwd:root,stdio:quiet?'pipe':'inherit',encoding:'utf8'})
const rehearsal='eduos_restore_'+randomUUID().replaceAll('-',''),remote='/tmp/'+rehearsal
docker(['compose','cp',path.join(folder,'database.dump'),'postgres:'+remote+'.dump'])
docker(['compose','cp',path.join(folder,'documents.tar.gz'),'school-service:'+remote+'.tar.gz'])
let created=false
try {
 docker(['compose','exec','-T','postgres','createdb','-U',env.POSTGRES_USER,rehearsal]);created=true
 docker(['compose','exec','-T','postgres','pg_restore','-U',env.POSTGRES_USER,'-d',rehearsal,'--exit-on-error','--no-owner',remote+'.dump'])
 const types=docker(['compose','exec','-T','school-service','tar','-tvzf',remote+'.tar.gz'],true).trim().split(/\r?\n/).filter(Boolean)
 if(types.some(line=>!line.startsWith('-')&&!line.startsWith('d')))throw Error('Links and special files are not allowed in a document backup.')
 const listed=docker(['compose','exec','-T','school-service','tar','-tzf',remote+'.tar.gz'],true).trim().split(/\r?\n/).filter(Boolean)
 if(listed.some(name=>name!== './'&&!/^\.\/[a-f0-9]{32}\.bin$/.test(name)))throw Error('Unsafe or unexpected document archive entry.')
 const expected=docker(['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',rehearsal,'-At','-c',"SELECT replace(id::text,'-','') || '.bin' FROM suite.documents"],true).trim().split(/\r?\n/).filter(Boolean)
 if(expected.some(name=>!listed.includes('./'+name)))throw Error('Backup is missing a registered document.')
 // Extract only into a unique temporary directory to verify compressed contents as well.
 docker(['compose','exec','-T','school-service','mkdir',remote])
 docker(['compose','exec','-T','school-service','tar','-xzf',remote+'.tar.gz','-C',remote])
 const sizes=docker(['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',rehearsal,'-At','-c',"SELECT replace(id::text,'-','') || '.bin:' || length FROM suite.documents"],true).trim().split(/\r?\n/).filter(Boolean)
 for(const item of sizes){const[name,length]=item.split(':');const actual=docker(['compose','exec','-T','school-service','stat','-c','%s',remote+'/'+name],true).trim();if(actual!==length)throw Error('Document size mismatch: '+name)}
 for(const name of listed.filter(n=>n!=='./'))docker(['compose','exec','-T','school-service','rm','--',remote+'/'+name.slice(2)])
 docker(['compose','exec','-T','school-service','rmdir',remote])
 console.log('Restore rehearsal passed: database restored and '+expected.length+' registered document(s) verified.')
 if(args.includes('--apply')){
  if(args[args.indexOf('--confirm')+1]!==env.POSTGRES_DB||!args.includes('--confirm'))throw Error('Live restore requires --confirm '+env.POSTGRES_DB)
  // Create a fresh rollback backup before replacing the application database.
  execFileSync(process.execPath,[path.join(root,'scripts/backup.mjs')],{cwd:root,stdio:'inherit'})
  const services=['nginx','api-gateway','auth-service','school-service','student-service','teacher-service','parent-service']
  docker(['compose','stop',...services])
  let restored=false
  try{
   docker(['compose','exec','-T','postgres','pg_restore','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'--clean','--if-exists','--exit-on-error','--single-transaction','--no-owner',remote+'.dump'])
   // Existing GUID-named files are retained; restored database exposes only its own registered files.
   docker(['compose','run','--rm','--no-deps','--user','root','--entrypoint','sh','-v',folder+':/restore:ro','school-service','-c','tar -xzf /restore/documents.tar.gz -C /app/documents && chown -R app:app /app/documents'])
   restored=true
  }finally{
   if(restored)docker(['compose','up','-d','--wait','--wait-timeout','180'])
   else console.error('Restore failed. Services remain stopped; use the fresh rollback backup before restarting.')
  }
  console.log('Live restore complete.')
 }
} finally {
 if(created)docker(['compose','exec','-T','postgres','dropdb','-U',env.POSTGRES_USER,rehearsal])
 docker(['compose','exec','-T','postgres','rm','--',remote+'.dump'])
 // Container might be stopped after a failed live restore, so preserve its temporary archive if cleanup is unavailable.
 try{docker(['compose','exec','-T','school-service','rm','--',remote+'.tar.gz'])}catch{}
}
