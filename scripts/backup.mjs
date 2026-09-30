import {execFileSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-')
const output=path.join(root,'backups','eduos-'+stamp)
mkdirSync(output,{recursive:true})
const docker=args=>execFileSync('docker',args,{cwd:root,stdio:'inherit'})
const remote='/tmp/eduos-'+stamp
let stopped=false
try {
 // Gateway shutdown drains external writes before the paired database/document snapshot.
 stopped=true;docker(['compose','stop','nginx','api-gateway'])
 docker(['compose','exec','-T','postgres','sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$1"','backup',remote+'.dump'])
 docker(['compose','exec','-T','postgres','pg_restore','--list',remote+'.dump'])
 docker(['compose','cp','postgres:'+remote+'.dump',path.join(output,'database.dump')])
 docker(['compose','exec','-T','school-service','tar','-czf',remote+'.tar.gz','-C','/app/documents','.'])
 docker(['compose','cp','school-service:'+remote+'.tar.gz',path.join(output,'documents.tar.gz')])
 const files=Object.fromEntries(['database.dump','documents.tar.gz'].map(name=>[name,createHash('sha256').update(readFileSync(path.join(output,name))).digest('hex')]))
 writeFileSync(path.join(output,'manifest.json'),JSON.stringify({format:1,createdAt:new Date().toISOString(),files},null,2))
 docker(['compose','exec','-T','postgres','rm','--',remote+'.dump'])
 docker(['compose','exec','-T','school-service','rm','--',remote+'.tar.gz'])
 console.log('Database and documents backup saved: '+output)
} finally {
 if(stopped)docker(['compose','up','-d','--wait','--wait-timeout','180','api-gateway','nginx'])
}
