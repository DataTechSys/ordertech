using OrderTech.SuperAdmin.Domain.Entities;

namespace OrderTech.SuperAdmin.Domain.Interfaces;

public interface IOrderRepository
{
    Task<IEnumerable<Order>> GetByTenantIdAsync(string tenantId, int limit = 100, int offset = 0);
    Task<IEnumerable<SalesOrder>> GetSalesOrdersByTenantIdAsync(string tenantId, int limit = 100, int offset = 0);
    Task<Order?> GetByIdAsync(Guid id);
    Task<int> GetCountByTenantIdAsync(string tenantId);
}
