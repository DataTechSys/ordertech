using OrderTech.SuperAdmin.Application.Interfaces;
using OrderTech.SuperAdmin.Domain.Entities;
using OrderTech.SuperAdmin.Domain.Interfaces;

namespace OrderTech.SuperAdmin.Application.Services;

public class OrderService : IOrderService
{
    private readonly IOrderRepository _orderRepository;

    public OrderService(IOrderRepository orderRepository)
    {
        _orderRepository = orderRepository;
    }

    public async Task<IEnumerable<Order>> GetOrdersByTenantIdAsync(Guid tenantId, int limit = 100, int offset = 0)
    {
        return await _orderRepository.GetByTenantIdAsync(tenantId, limit, offset);
    }

    public async Task<IEnumerable<SalesOrder>> GetSalesOrdersByTenantIdAsync(Guid tenantId, int limit = 100, int offset = 0)
    {
        return await _orderRepository.GetSalesOrdersByTenantIdAsync(tenantId, limit, offset);
    }

    public async Task<(IEnumerable<Order> cashierOrders, IEnumerable<SalesOrder> salesOrders)> GetAllOrdersByTenantIdAsync(Guid tenantId, int limit = 1000)
    {
        var cashierOrdersTask = _orderRepository.GetByTenantIdAsync(tenantId, limit, 0);
        var salesOrdersTask = _orderRepository.GetSalesOrdersByTenantIdAsync(tenantId, limit, 0);
        
        await Task.WhenAll(cashierOrdersTask, salesOrdersTask);
        
        return (await cashierOrdersTask, await salesOrdersTask);
    }
}
