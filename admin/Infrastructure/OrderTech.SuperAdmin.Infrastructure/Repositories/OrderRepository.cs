using Microsoft.EntityFrameworkCore;
using OrderTech.SuperAdmin.Domain.Entities;
using OrderTech.SuperAdmin.Domain.Interfaces;
using OrderTech.SuperAdmin.Infrastructure.Data;

namespace OrderTech.SuperAdmin.Infrastructure.Repositories;

public class OrderRepository : IOrderRepository
{
    private readonly OrderTechDbContext _context;

    public OrderRepository(OrderTechDbContext context)
    {
        _context = context;
    }

    public async Task<IEnumerable<Order>> GetByTenantIdAsync(Guid tenantId, int limit = 100, int offset = 0)
    {
        return await _context.Orders
            .Where(o => o.TenantId == tenantId)
            .OrderByDescending(o => o.PaidAt ?? o.CreatedAt)
            .Skip(offset)
            .Take(limit)
            .Include(o => o.Branch)
            .ToListAsync();
    }

    public async Task<IEnumerable<SalesOrder>> GetSalesOrdersByTenantIdAsync(Guid tenantId, int limit = 100, int offset = 0)
    {
        return await _context.SalesOrders
            .Where(o => o.TenantId == tenantId)
            .OrderByDescending(o => o.CreatedAt)
            .Skip(offset)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<Order?> GetByIdAsync(Guid id)
    {
        return await _context.Orders
            .Include(o => o.Branch)
            .Include(o => o.Tenant)
            .FirstOrDefaultAsync(o => o.Id == id);
    }

    public async Task<int> GetCountByTenantIdAsync(Guid tenantId)
    {
        return await _context.Orders
            .Where(o => o.TenantId == tenantId)
            .CountAsync();
    }
}
