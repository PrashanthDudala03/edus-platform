using Microsoft.EntityFrameworkCore;
using Services.Auth.Models;

namespace Services.Auth.Data;

public interface IUserRepository
{
    Task<User?> GetByUsernameAsync(Guid schoolId, string username);
    /// <summary>Non-deleted accounts, active or not, whose username or email equals the sign-in name; limited to one school when given.</summary>
    Task<List<User>> FindLoginCandidatesAsync(Guid? schoolId, string login);
    Task<bool> IsSchoolActiveAsync(Guid schoolId);
    Task<User?> GetByIdAsync(Guid userId);
    Task<User?> GetByEmailAsync(Guid schoolId, string email);
    Task CreateAsync(User user);
    Task UpdateAsync(User user);
    Task SaveChangesAsync();
}

public class UserRepository : IUserRepository
{
    private readonly AuthDbContext _context;

    public UserRepository(AuthDbContext context)
    {
        _context = context;
    }

    public async Task<User?> GetByUsernameAsync(Guid schoolId, string username)
    {
        return await _context.Users
            .Include(u => u.Role)
                .ThenInclude(role => role!.Permissions)
            .FirstOrDefaultAsync(u => u.SchoolId == schoolId && u.Username == username && u.IsActive);
    }

    public async Task<List<User>> FindLoginCandidatesAsync(Guid? schoolId, string login) {
        var users = await _context.Users
            .Include(u => u.Role)
                .ThenInclude(role => role!.Permissions)
            .Where(u => (schoolId == null || u.SchoolId == schoolId) && (u.Username == login || u.Email == login))
            .OrderBy(u => u.CreatedAt)
            .Take(10)
            .ToListAsync();
        foreach(var user in users) await Iam.Hydrate(_context,user);
        return users;
    }

    public Task<bool> IsSchoolActiveAsync(Guid schoolId) => RoleModel.SchoolIsActive(_context, schoolId);

    public async Task<User?> GetByIdAsync(Guid userId)
    {
        var user = await _context.Users
            .Include(u => u.Role)
                .ThenInclude(role => role!.Permissions)
            .FirstOrDefaultAsync(u => u.Id == userId && u.IsActive);
        if(user != null) await Iam.Hydrate(_context,user);
        return user?.CanSignIn == true ? user : null;
    }

    public async Task<User?> GetByEmailAsync(Guid schoolId, string email)
    {
        return await _context.Users
            .Include(u => u.Role)
                .ThenInclude(role => role!.Permissions)
            .FirstOrDefaultAsync(u => u.SchoolId == schoolId && u.Email == email && u.IsActive);
    }

    public async Task CreateAsync(User user)
    {
        await _context.Users.AddAsync(user);
        await _context.SaveChangesAsync();
    }

    public async Task UpdateAsync(User user)
    {
        // Login only updates LastLoginAt; never overwrite a concurrent authorization version.
        _context.Entry(user).Property(u=>u.LastLoginAt).IsModified=true;
        await _context.SaveChangesAsync();
    }

    public async Task SaveChangesAsync()
    {
        await _context.SaveChangesAsync();
    }
}

public interface IRefreshTokenRepository
{
    Task<RefreshToken?> GetByTokenAsync(string token);
    Task CreateAsync(RefreshToken refreshToken);
    Task RevokeAsync(Guid tokenId);
    Task SaveChangesAsync();
}

public class RefreshTokenRepository : IRefreshTokenRepository
{
    private readonly AuthDbContext _context;

    public RefreshTokenRepository(AuthDbContext context)
    {
        _context = context;
    }

    public async Task<RefreshToken?> GetByTokenAsync(string token)
    {
        var tokenHash = HashToken(token);
        return await _context.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.Token == tokenHash && rt.RevokedAt == null && rt.ExpiresAt > DateTime.UtcNow);
    }

    public async Task CreateAsync(RefreshToken refreshToken)
    {
        refreshToken.Token = HashToken(refreshToken.Token);
        await _context.RefreshTokens.AddAsync(refreshToken);
        await _context.SaveChangesAsync();
    }

    public async Task RevokeAsync(Guid tokenId)
    {
        var changed=await _context.RefreshTokens.Where(t=>t.Id==tokenId && t.RevokedAt==null).ExecuteUpdateAsync(u=>u.SetProperty(t=>t.RevokedAt,DateTime.UtcNow));
        if(changed!=1) throw new InvalidOperationException("Refresh token was already used.");
    }

    public async Task SaveChangesAsync()
    {
        await _context.SaveChangesAsync();
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
}
