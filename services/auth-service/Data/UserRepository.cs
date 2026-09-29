using Microsoft.EntityFrameworkCore;
using Services.Auth.Models;

namespace Services.Auth.Data;

public interface IUserRepository
{
    Task<User?> GetByUsernameAsync(Guid schoolId, string username);
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

    public async Task<User?> GetByIdAsync(Guid userId)
    {
        return await _context.Users
            .Include(u => u.Role)
                .ThenInclude(role => role!.Permissions)
            .FirstOrDefaultAsync(u => u.Id == userId && u.IsActive);
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
        _context.Users.Update(user);
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
