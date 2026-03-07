using OrderTech.SuperAdmin.Domain.Entities;

namespace OrderTech.SuperAdmin.Application.Interfaces;

public interface ITenantService
{
    Task<IEnumerable<Tenant>> GetAllTenantsAsync();
    Task<Tenant?> GetTenantByIdAsync(Guid id);
    Task<Tenant> CreateTenantAsync(Tenant tenant);
    Task UpdateTenantAsync(Tenant tenant);
    Task DeleteTenantAsync(Guid id);
}
