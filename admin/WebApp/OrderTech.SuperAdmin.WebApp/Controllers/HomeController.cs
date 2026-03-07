using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using OrderTech.SuperAdmin.Application.Interfaces;
using OrderTech.SuperAdmin.WebApp.Models;

namespace OrderTech.SuperAdmin.WebApp.Controllers;

public class HomeController : Controller
{
    private readonly ITenantService _tenantService;
    private readonly IUserService _userService;

    public HomeController(ITenantService tenantService, IUserService userService)
    {
        _tenantService = tenantService;
        _userService = userService;
    }

    public async Task<IActionResult> Index()
    {
        // Check if logged in
        var userEmail = HttpContext.Session.GetString("UserEmail");
        if (string.IsNullOrEmpty(userEmail))
        {
            return RedirectToAction("Login", "Auth");
        }

        // Get dashboard stats
        var tenants = await _tenantService.GetAllTenantsAsync();
        var users = await _userService.GetAllUsersAsync();

        ViewBag.TenantCount = tenants.Count();
        ViewBag.UserCount = users.Count();
        ViewBag.UserName = HttpContext.Session.GetString("UserName");

        return View();
    }

    public IActionResult Privacy()
    {
        return View();
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}
