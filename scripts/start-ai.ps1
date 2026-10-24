param([switch]$Build)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
 if(!(Test-Path '.local/ai.env') -or !(Test-Path '.local/compose.ai.yml')) { throw 'Local AI configuration is missing. See docs/ai/LOCAL_SETUP.md.' }
 $modelHost= & docker run --rm --entrypoint getent edus-ai-service:1.0.0-rc.1 ahostsv4 host.docker.internal
 $env:OLLAMA_HOST_ADDRESS=([regex]::Match(($modelHost -join ' '),'(?:\d{1,3}\.){3}\d{1,3}')).Value
 if(!$env:OLLAMA_HOST_ADDRESS){throw 'Could not resolve the Docker Desktop model host.'}
 $composeArgs=@('compose','--env-file','.env','--env-file','.local/ai.env','-f','docker-compose.yml','-f','docker-compose.override.yml','-f','.local/compose.ai.yml','--profile','ai')
 $upArgs=@('up','-d','--wait','--wait-timeout','180')
 if($Build){$upArgs+='--build'}
 & docker @composeArgs @upArgs
 if($LASTEXITCODE -ne 0){throw 'AI stack startup failed.'}
 # Settings are separate from IAM. Enable only existing active schools, preserving later decisions.
 $schoolIds= & docker compose exec -T postgres psql -U edus -d edus -Atc "SELECT id FROM school_db.schools WHERE is_active AND deleted_at IS NULL AND id <> '00000000-0000-0000-0000-00000000e005'"
 if($LASTEXITCODE -ne 0){throw 'Could not list active schools.'}
 foreach($schoolId in $schoolIds){
  $parsedId=[guid]::Empty
  if([guid]::TryParse($schoolId.Trim(),[ref]$parsedId)){
   "INSERT INTO ai.school_settings(school_id,enabled,monthly_token_budget,max_tier) VALUES('$parsedId',true,1000000,1) ON CONFLICT(school_id) DO NOTHING;" | & docker @composeArgs exec -T ai-db psql -U eduos_ai_owner -d eduos_ai
   if($LASTEXITCODE -ne 0){throw 'Could not initialize school AI settings.'}
  }
 }
 Write-Output 'EduOS AI is ready at http://localhost:8081. Sign in again to refresh permissions.'
} finally { Pop-Location }
