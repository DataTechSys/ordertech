using Microsoft.AspNetCore.Mvc;
using OrderTech.SuperAdmin.Application.Interfaces;

namespace OrderTech.SuperAdmin.WebApp.Controllers;

public class TenantsController : Controller
{
    private readonly ITenantService _tenantService;

    public TenantsController(ITenantService tenantService)
    {
        _tenantService = tenantService;
    }

    public async Task<IActionResult> Index()
    {
        var tenants = await _tenantService.GetAllTenantsAsync();
        return View(tenants);
    }

    public async Task<IActionResult> Details(string id)
    {
        var tenant = await _tenantService.GetTenantByIdAsync(id);
        if (tenant == null)
        {
            return NotFound();
        }
        return View(tenant);
    }
}
