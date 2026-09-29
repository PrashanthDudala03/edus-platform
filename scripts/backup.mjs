import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
const stamp=new Date().toISOString().replace(/[:.]/g,'-')
const remote='/tmp/eduos-'+stamp+'.dump'
const output=path.join(root,'backups','eduos-'+stamp+'.dump')
mkdirSync(path.dirname(output),{recursive:true})
const docker=(args)=>execFileSync('docker',args,{cwd:root,stdio:'inherit'})
docker(['compose','exec','-T','postgres','sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$1"','backup',remote])
docker(['compose','exec','-T','postgres','pg_restore','--list',remote])
docker(['compose','cp','postgres:'+remote,output])
docker(['compose','exec','-T','postgres','rm','--',remote])
console.log('Database backup saved: '+output)
