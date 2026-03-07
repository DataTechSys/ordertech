using Microsoft.EntityFrameworkCore;
using OrderTech.SuperAdmin.Domain.Entities;
using OrderTech.SuperAdmin.Domain.Interfaces;
using OrderTech.SuperAdmin.Infrastructure.Data;

namespace OrderTech.SuperAdmin.Infrastructure.Repositories;

public class TenantRepository : ITenantRepository
{
    private readonly OrderTechDbContext _context;

    public TenantRepository(OrderTechDbContext context)
    {
        _context = context;
    }

    public async Task<IEnumerable<Tenant>> GetAllAsync()
    {
        return await _context.Tenants
            .OrderBy(t => t.Name)
            .ToListAsync();
    }

    public async Task<Tenant?> GetByIdAsync(Guid id)
    {
        return await _context.Tenants
            .Include(t => t.Branches)
            .FirstOrDefaultAsync(t => t.Id == id);
    }

    public async Task<Tenant> CreateAsync(Tenant tenant)
    {
        tenant.Id = Guid.NewGuid();
        tenant.CreatedAt = DateTime.UtcNow;
        _context.Tenants.Add(tenant);
        await _context.SaveChangesAsync();
        return tenant;
    }

    public async Task UpdateAsync(Tenant tenant)
    {
        tenant.UpdatedAt = DateTime.UtcNow;
        _context.Tenants.Update(tenant);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(Guid id)
    {
        var tenant = await _context.Tenants.FindAsync(id);
        if (tenant != null)
        {
            _context.Tenants.Remove(tenant);
            await _context.SaveChangesAsync();
        }
    }
}
