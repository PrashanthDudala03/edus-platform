const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tag=randomUUID().replaceAll('-',''),database='eduos_ai_restore_'+tag,remote='/tmp/'+database+'.dump',folder=path.join(root,'backups','ai-rehearsal-'+tag);fs.mkdirSync(folder,{recursive:true});
const docker=args=>execFileSync('docker',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']});
let created=false;
try{
docker(['exec','eduos-ai-db-1','sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$1"','backup',remote]);
docker(['cp','eduos-ai-db-1:'+remote,path.join(folder,'ai-database.dump')]);
docker(['exec','eduos-ai-db-1','sh','-c','createdb -U "$POSTGRES_USER" "$1"','restore',database]);created=true;
docker(['exec','eduos-ai-db-1','sh','-c','pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error --no-owner "$2"','restore',database,remote]);
const count=docker(['exec','eduos-ai-db-1','sh','-c','psql -U "$POSTGRES_USER" -d "$1" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN (\x27pg_catalog\x27,\x27information_schema\x27);"','check',database]).trim();assert(Number(count)>0);
const hash=createHash('sha256').update(fs.readFileSync(path.join(folder,'ai-database.dump'))).digest('hex');fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({format:1,component:'ai-db',createdAt:new Date().toISOString(),files:{'ai-database.dump':hash},isolatedRestorePassed:true,restoredTables:Number(count)},null,2));
console.log(JSON.stringify({aiBackupFolder:folder,isolatedRestorePassed:true,restoredTables:Number(count),note:'Separate AI snapshot; not an atomic cross-database snapshot.'}));
}finally{if(created)docker(['exec','eduos-ai-db-1','sh','-c','dropdb -U "$POSTGRES_USER" "$1"','cleanup',database]);docker(['exec','eduos-ai-db-1','rm','--',remote]);}
