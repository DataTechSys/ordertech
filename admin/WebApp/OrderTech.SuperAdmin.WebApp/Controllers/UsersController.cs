using Microsoft.AspNetCore.Mvc;
using OrderTech.SuperAdmin.Application.Interfaces;
using OrderTech.SuperAdmin.Domain.Entities;

namespace OrderTech.SuperAdmin.WebApp.Controllers;

public class UsersController : Controller
{
    private readonly IUserService _userService;

    public UsersController(IUserService userService)
    {
        _userService = userService;
    }

    public async Task<IActionResult> Index()
    {
        var users = await _userService.GetAllUsersAsync();
        return View(users);
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        try
        {
            var users = await _userService.GetAllUsersAsync();
            return Json(new
            {
                success = true,
                users = users.Select(u => new
                {
                    id = u.Id,
                    email = u.Email,
                    name = u.Name,
                    role = u.Role,
                    tenantName = u.Tenant?.Name,
                    isActive = u.IsActive,
                    status = u.Status,
                    createdAt = u.CreatedAt,
                    modifiedAt = u.ModifiedAt
                })
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest request)
    {
        try
        {
            var user = new User
            {
                Email = request.Email,
                Name = request.Name,
                TenantId = request.TenantId ?? Guid.Empty,
                Status = "active",
                RoleId = Guid.Empty, // TODO: Look up role ID from role name
                CreatedAt = DateTime.UtcNow
            };

            await _userService.CreateUserAsync(user, request.Password);
            return Json(new { success = true, user = user });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> Update([FromBody] UpdateUserRequest request)
    {
        try
        {
            var user = await _userService.GetUserByIdAsync(request.Id);
            if (user == null)
            {
                return Json(new { success = false, error = "User not found" });
            }

            user.Email = request.Email;
            user.Name = request.Name;
            user.Status = request.IsActive ? "active" : "inactive";
            user.ModifiedAt = DateTime.UtcNow;
            // TODO: Update role_id from request.Role

            await _userService.UpdateUserAsync(user);
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> Delete(Guid id)
    {
        try
        {
            await _userService.DeleteUserAsync(id);
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    public class CreateUserRequest
    {
        public string Email { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string Role { get; set; } = "User";
        public Guid? TenantId { get; set; }
    }

    public class UpdateUserRequest
    {
        public Guid Id { get; set; }
        public string Email { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Role { get; set; } = "User";
        public bool IsActive { get; set; }
    }
}
