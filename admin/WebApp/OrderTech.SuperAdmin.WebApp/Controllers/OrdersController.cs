using Microsoft.AspNetCore.Mvc;
using OrderTech.SuperAdmin.Application.Interfaces;
using System.Text.Json;

namespace OrderTech.SuperAdmin.WebApp.Controllers;

public class OrdersController : Controller
{
    private readonly IOrderService _orderService;
    private readonly ITenantService _tenantService;

    public OrdersController(IOrderService orderService, ITenantService tenantService)
    {
        _orderService = orderService;
        _tenantService = tenantService;
    }

    public IActionResult Index()
    {
        return View();
    }

    [HttpGet]
    public async Task<IActionResult> GetOrders(Guid tenantId, int limit = 1000)
    {
        try
        {
            var (cashierOrders, salesOrders) = await _orderService.GetAllOrdersByTenantIdAsync(tenantId, limit);
            
            return Json(new
            {
                success = true,
                cashierOrders = cashierOrders.Select(o => new
                {
                    orderType = "cashier",
                    orderId = o.TicketNo,
                    orderDate = o.PaidAt ?? o.CreatedAt,
                    customer = o.CustomerName ?? "Walk-in",
                    branch = o.Branch?.Name ?? o.Location ?? "Unknown",
                    status = "paid",
                    total = o.Total,
                    currency = o.Currency,
                    items = ParseItems(o.ItemsJson)
                }),
                salesOrders = salesOrders.Select(o => new
                {
                    orderType = "foodics",
                    orderId = o.ExternalId,
                    orderDate = o.CreatedAt,
                    customer = o.CustomerName ?? "Walk-in",
                    branch = o.BranchName ?? "Unknown",
                    status = o.Status,
                    total = o.Total,
                    currency = o.Currency,
                    items = ParseItems(o.ItemsJson)
                })
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    private object ParseItems(string itemsJson)
    {
        try
        {
            return JsonSerializer.Deserialize<object>(itemsJson) ?? Array.Empty<object>();
        }
        catch
        {
            return Array.Empty<object>();
        }
    }
}
