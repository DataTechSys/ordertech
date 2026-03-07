using OrderTech.SuperAdmin.Domain.Entities;

namespace OrderTech.SuperAdmin.Application.Interfaces;

public interface IOrderService
{
    Task<IEnumerable<Order>> GetOrdersByTenantIdAsync(string tenantId, int limit = 100, int offset = 0);
    Task<IEnumerable<SalesOrder>> GetSalesOrdersByTenantIdAsync(string tenantId, int limit = 100, int offset = 0);
    Task<(IEnumerable<Order> cashierOrders, IEnumerable<SalesOrder> salesOrders)> GetAllOrdersByTenantIdAsync(string tenantId, int limit = 1000);
}
