import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { seedIamSql } from './iam-fixtures'

// Never execute this fixture against a developer's existing Docker/E2E database.
test('P1 guardian uniqueness, linking, tenant boundaries and PostgreSQL upgrade', async ({ playwright }) => {
 test.skip(process.env.GITHUB_ACTIONS !== 'true', 'Isolated GitHub Actions database only')
 test.setTimeout(180000)
 const root = path.resolve(import.meta.dirname, '../..')
 const env = Object.fromEntries(readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => { const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1)] }))
 const sql = (query:string, database=env.POSTGRES_DB) => execFileSync('docker', ['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',database,'-AtX','-v','ON_ERROR_STOP=1'], { cwd:root,input:query,encoding:'utf8',stdio:['pipe','pipe','pipe'] }).trim()
 const schools = [randomUUID(), randomUUID()]
 const migrationDb = 'p1_'+randomUUID().replaceAll('-','')
 const migration = readFileSync(path.join(root,'services/auth-service/Migrations/20261007_01_guardian_phone_scope.sql'),'utf8')
 sql(`CREATE DATABASE ${migrationDb}`)
 try {
  // Reproduce the old PostgreSQL constraint, preserve a linked guardian, and run
  // the actual shipped migration twice to verify upgrade and idempotency.
  sql(`CREATE SCHEMA auth_db; CREATE SCHEMA parent_db;
   CREATE TABLE auth_db.schema_migrations(id text PRIMARY KEY);
   CREATE TABLE parent_db.parents(id uuid PRIMARY KEY, school_id uuid NOT NULL, phone_number varchar(20) NOT NULL UNIQUE);
   CREATE TABLE parent_db.links(parent_id uuid REFERENCES parent_db.parents(id));
   INSERT INTO parent_db.parents VALUES('${schools[0]}','${schools[0]}','9000000001');
   INSERT INTO parent_db.links VALUES('${schools[0]}');`,migrationDb)
  const duplicate = `INSERT INTO parent_db.parents VALUES('${schools[1]}','${schools[1]}','9000000001');`
  expect(()=>sql(duplicate,migrationDb)).toThrow(/parents_phone_number_key/)
  sql('BEGIN;'+migration+'COMMIT;',migrationDb)
  sql('BEGIN;'+migration+'COMMIT;',migrationDb)
  sql(duplicate,migrationDb)
  expect(()=>sql(`INSERT INTO parent_db.parents VALUES('${randomUUID()}','${schools[0]}','9000000001');`,migrationDb)).toThrow(/parents_school_phone_number_key/)
  expect(sql('SELECT count(*) FROM parent_db.links;',migrationDb)).toBe('1')
  expect(sql("SELECT count(*) FROM auth_db.schema_migrations WHERE id='20261007_01_guardian_phone_scope';",migrationDb)).toBe('1')
  expect(sql("SELECT count(*) FROM pg_constraint WHERE conrelid='parent_db.parents'::regclass AND conname='parents_phone_number_key';",migrationDb)).toBe('0')
 } finally { sql(`DROP DATABASE ${migrationDb}`) }

 const api = await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'})
 const tokens:string[]=[], parents:string[]=[], students:string[]=[], admissions:string[]=[]
 const phone='9'+Date.now().toString().slice(-9)
 try {
  for(const school of schools) {
   const role=randomUUID(), user=randomUUID()
   sql(`INSERT INTO school_db.schools(id,name) VALUES('${school}','P1 CI school');
    INSERT INTO auth_db.roles(id,school_id,name) VALUES('${role}','${school}','Administrator');
    INSERT INTO auth_db.users(id,school_id,username,email,password_hash,first_name,last_name,role_id)
    SELECT '${user}','${school}','p1-${school}','p1-${school}@example.test',password_hash,'P1','Admin','${role}' FROM auth_db.users
    WHERE school_id='${env.EDUOS_BOOTSTRAP_SCHOOL_ID}' AND username='${env.EDUOS_BOOTSTRAP_ADMIN_USERNAME}';`+seedIamSql(school))
   let login=await api.post('/api/v1/auth/login',{data:{schoolId:school,username:'p1-'+school,password:env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD}})
   for(let retry=0;login.status()===429 && retry<15;retry++) {await new Promise(r=>setTimeout(r,6500));login=await api.post('/api/v1/auth/login',{data:{schoolId:school,username:'p1-'+school,password:env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD}})}
   expect(login.status()).toBe(200)
   const token=(await login.json()).data.accessToken; tokens.push(token)
   const headers={Authorization:'Bearer '+token}
   // No retry/delay after issuance: exercise the live issuer and validator.
   expect((await api.get('/api/v1/users?pageSize=1',{headers})).status()).toBe(200)
   const guardian={schoolId:school,firstName:'P1',lastName:'Guardian',email:`guardian-${school}@example.test`,phoneNumber:phone}
   const created=await api.post('/api/v1/parents',{headers,data:guardian})
   expect(created.status(),await created.text()).toBe(201);parents.push((await created.json()).data.id)
   expect((await api.post('/api/v1/parents',{headers,data:{...guardian,email:`duplicate-${school}@example.test`}})).status()).toBe(409)
   const student=await api.post('/api/v1/students',{headers,data:{schoolId:school,rollNumber:'P1-1',firstName:'P1',lastName:'Student',email:`student-${school}@example.test`,phoneNumber:'8000000001',currentClass:'Grade 1',dateOfBirth:'2015-01-01T00:00:00Z'}})
   expect(student.status(),await student.text()).toBe(201);students.push((await student.json()).data.id)
   const id=randomUUID();admissions.push(id)
   sql(`INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES('${id}','${school}','admissions','${JSON.stringify({status:'Onboarding',firstName:'P1',lastName:'Applicant',dateOfBirth:'2015-01-01',guardianPhone:phone,guardianEmail:guardian.email,guardianName:'P1 Guardian',onboarding:{guardian:{mode:'new'},documents:{},accounts:{},fees:{}}})}'::jsonb,'${user}','${user}');`)
  }
  expect(parents[0]).not.toBe(parents[1])
  for(let i=0;i<2;i++) {
   const other=1-i, headers={Authorization:'Bearer '+tokens[i]}
   const candidates=await api.get(`/api/v1/suite/admissions/${admissions[i]}/candidates`,{headers})
   expect(candidates.status()).toBe(200)
   expect((await candidates.json()).data.guardians.map((p:any)=>p.id)).toEqual([parents[i]])
   const link=(parentId:string)=>api.put(`/api/v1/suite/admissions/${admissions[i]}/onboarding`,{headers,data:{section:'guardian',mode:'existing',parentId,relationship:'Mother',confirmed:true}})
   expect((await link(parents[i])).status()).toBe(200)
   expect([400,403,404]).toContain((await link(parents[other])).status())
   expect(sql(`SELECT data->'onboarding'->'guardian'->>'parentId' FROM suite.records WHERE id='${admissions[i]}';`)).toBe(parents[i])
   expect((await api.get(`/api/v1/parents?schoolId=${schools[other]}`,{headers})).status()).toBe(403)
   const own=await api.get('/api/v1/parents?pageSize=100',{headers})
   expect(own.status()).toBe(200)
   expect((await own.json()).data.data.map((p:any)=>p.id)).toEqual([parents[i]])
   expect((await api.get(`/api/v1/suite/students/${students[i]}/360`,{headers})).status()).toBe(200)
   expect([403,404]).toContain((await api.get(`/api/v1/suite/students/${students[other]}/360`,{headers})).status())
  }
 } finally { await api.dispose() }
 // CI destroys its isolated stack after this job; never clean local E2E records.
})
