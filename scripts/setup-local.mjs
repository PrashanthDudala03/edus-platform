import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
if(fs.existsSync(path.join(root,'.env'))){console.log('Existing .env preserved.');process.exit(0)}
const key=crypto.generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const password=crypto.randomBytes(24).toString('base64url')
const values={CHANGE_ME_BASE64_PRIVATE_PEM:Buffer.from(key.privateKey).toString('base64'),CHANGE_ME_BASE64_PUBLIC_PEM:Buffer.from(key.publicKey).toString('base64'),CHANGE_ME_SCHOOL_NAME:'My School',CHANGE_ME_ADMIN_USERNAME:'school.admin',CHANGE_ME_ADMIN_EMAIL:'admin@school.local',CHANGE_ME_USE_A_UNIQUE_PASSWORD_AT_LEAST_16_CHARACTERS:password,CHANGE_ME_UNIQUE_DATABASE_PASSWORD:crypto.randomBytes(32).toString('hex'),CHANGE_ME_OPERATIONS_EMAIL:'operations@school.local',CHANGE_ME_UNIQUE_PGADMIN_PASSWORD:crypto.randomBytes(24).toString('hex')}
let env=fs.readFileSync(path.join(root,'.env.example'),'utf8')
for(const [key,value]of Object.entries(values))env=env.replace(key,value)
fs.writeFileSync(path.join(root,'.env'),env,{mode:0o600})
fs.mkdirSync(path.join(root,'.local'),{recursive:true})
fs.writeFileSync(path.join(root,'.local/ACCESS.txt'),'EduOS local access\nURL: http://localhost:8080\nUsername: school.admin\nPassword: '+password+'\n\nChange the school name in School settings.\nKeep this file private. It is ignored by Git.\n',{mode:0o600})
console.log('Generated .env and private credentials in .local/ACCESS.txt.')
