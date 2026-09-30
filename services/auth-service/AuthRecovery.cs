using System.Security.Cryptography;
using System.Text;
using EduOS.ServiceAuth;
using Microsoft.EntityFrameworkCore;
using Services.Auth.Data;
public static class AuthRecovery
{
 public static Task Initialize(AuthDbContext db)=>db.Database.ExecuteSqlRawAsync("""
 ALTER TABLE auth_db.users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
 CREATE TABLE IF NOT EXISTS auth_db.password_resets(
 id uuid PRIMARY KEY,school_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES auth_db.users(id),
 code_hash varchar(64) NOT NULL UNIQUE,expires_at timestamptz NOT NULL,used_at timestamptz);
 """);
 public static void Map(WebApplication app){
  app.MapPost("/api/users/{id:guid}/recovery-code",async(Guid id,Guid schoolId,HttpContext http,AuthDbContext db)=>{
   var user=await db.Users.FirstOrDefaultAsync(u=>u.Id==id&&u.SchoolId==schoolId&&u.IsActive);
   if(user is null)return Results.NotFound(new{message="Active user not found."});
   await Iam.ManageableUser(db,http,user);
   var code=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
   await using var tx=await db.Database.BeginTransactionAsync(); await Iam.Lock(db);
   await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE auth_db.password_resets SET used_at=NOW() WHERE user_id={id} AND school_id={schoolId} AND used_at IS NULL");
   await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO auth_db.password_resets(id,school_id,user_id,code_hash,expires_at) VALUES({Guid.NewGuid()},{schoolId},{id},{hash},{DateTime.UtcNow.AddMinutes(15)})");
   await Iam.Audit(db,http.GetTenant(),schoolId,"user.recovery.issued",id,null,null);
   await tx.CommitAsync();return Results.Ok(new{data=new{code,expiresInMinutes=15},message="Share this one-time code privately with the verified account holder. No email or SMS was sent."});
  }).RequireAuthorization(EduOSPolicies.Administrators);
  app.MapPost("/api/auth/reset-password",async(PasswordRecoveryRequest request,AuthDbContext db)=>{
   if(string.IsNullOrWhiteSpace(request.Password)||request.Password.Length<16||Encoding.UTF8.GetByteCount(request.Password)>72)
    return Results.BadRequest(new{message="Use a password of at least 16 characters and no more than 72 UTF-8 bytes."});
   var code=request.Code?.Trim().ToUpperInvariant()??"";if(code.Length!=64)return Results.BadRequest(new{message="Recovery code is invalid or expired."});
   var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
   await using var tx=await db.Database.BeginTransactionAsync();
   var matches=await db.Database.SqlQuery<RecoveryRow>($"SELECT id AS \"Id\",user_id AS \"UserId\" FROM auth_db.password_resets WHERE code_hash={hash} AND used_at IS NULL AND expires_at>NOW() FOR UPDATE").ToListAsync();
   if(matches.Count!=1)return Results.BadRequest(new{message="Recovery code is invalid or expired."});
   var reset=matches[0];var user=await db.Users.FirstOrDefaultAsync(u=>u.Id==reset.UserId&&u.IsActive);
   if(user is null)return Results.BadRequest(new{message="Recovery code is invalid or expired."});
   user.PasswordHash=BCrypt.Net.BCrypt.HashPassword(request.Password,workFactor:12);user.TokenVersion++;user.UpdatedAt=DateTime.UtcNow;
   await db.SaveChangesAsync();
   await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE auth_db.password_resets SET used_at=NOW() WHERE id={reset.Id}");
   await db.RefreshTokens.IgnoreQueryFilters().Where(t=>t.UserId==user.Id).ExecuteUpdateAsync(s=>s.SetProperty(t=>t.RevokedAt,DateTime.UtcNow));
   await Iam.Audit(db,null,user.SchoolId,"user.password.reset",user.Id,null,new{sessionsRevoked=true});
   await tx.CommitAsync();return Results.Ok(new{message="Password changed. Previous sessions have been revoked. Sign in with the new password."});
  }).AllowAnonymous();
 }
}
public record PasswordRecoveryRequest(string? Code,string? Password);
public class RecoveryRow { public Guid Id{get;set;} public Guid UserId{get;set;} }
