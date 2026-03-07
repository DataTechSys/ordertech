using Microsoft.AspNetCore.Mvc;
using OrderTech.SuperAdmin.Application.Interfaces;

namespace OrderTech.SuperAdmin.WebApp.Controllers;

public class AuthController : Controller
{
    private readonly IUserService _userService;

    public AuthController(IUserService userService)
    {
        _userService = userService;
    }

    [HttpGet]
    public IActionResult Login()
    {
        // If already logged in, redirect to home
        if (HttpContext.Session.GetString("UserEmail") != null)
        {
            return RedirectToAction("Index", "Home");
        }
        return View();
    }

    [HttpPost]
    public async Task<IActionResult> Login(string email, string password)
    {
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
        {
            ViewBag.Error = "Email and password are required";
            return View();
        }

        var isValid = await _userService.ValidateUserCredentialsAsync(email, password);
        if (!isValid)
        {
            ViewBag.Error = "Invalid email or password";
            return View();
        }

        var user = await _userService.GetUserByEmailAsync(email);
        if (user == null || !user.IsActive || user.Role != "SuperAdmin")
        {
            ViewBag.Error = "Access denied. Super admin access required.";
            return View();
        }

        // Set session
        HttpContext.Session.SetString("UserEmail", user.Email);
        HttpContext.Session.SetString("UserName", user.Name ?? user.Email);
        HttpContext.Session.SetString("UserId", user.Id.ToString());

        return RedirectToAction("Index", "Home");
    }

    public IActionResult Logout()
    {
        HttpContext.Session.Clear();
        return RedirectToAction("Login");
    }
}
