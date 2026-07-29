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
            .FirstOrDefaultAsync(u => u.SchoolId == schoolId && u.Username == username && u.IsActive);
    }

    public async Task<User?> GetByIdAsync(Guid userId)
    {
        return await _context.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive);
    }

    public async Task<User?> GetByEmailAsync(Guid schoolId, string email)
    {
        return await _context.Users
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
    Task<RefreshToken?> GetByTokenAsync(Guid schoolId, string token);
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

    public async Task<RefreshToken?> GetByTokenAsync(Guid schoolId, string token)
    {
        return await _context.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.SchoolId == schoolId && rt.Token == token && rt.RevokedAt == null && rt.ExpiresAt > DateTime.UtcNow);
    }

    public async Task CreateAsync(RefreshToken refreshToken)
    {
        await _context.RefreshTokens.AddAsync(refreshToken);
        await _context.SaveChangesAsync();
    }

    public async Task RevokeAsync(Guid tokenId)
    {
        var token = await _context.RefreshTokens.FindAsync(tokenId);
        if (token != null)
        {
            token.RevokedAt = DateTime.UtcNow;
            _context.RefreshTokens.Update(token);
            await _context.SaveChangesAsync();
        }
    }

    public async Task SaveChangesAsync()
    {
        await _context.SaveChangesAsync();
    }
}
