using OrderTech.SuperAdmin.Application.Interfaces;
using OrderTech.SuperAdmin.Domain.Entities;
using OrderTech.SuperAdmin.Domain.Interfaces;

namespace OrderTech.SuperAdmin.Application.Services;

public class TenantService : ITenantService
{
    private readonly ITenantRepository _tenantRepository;

    public TenantService(ITenantRepository tenantRepository)
    {
        _tenantRepository = tenantRepository;
    }

    public async Task<IEnumerable<Tenant>> GetAllTenantsAsync()
    {
        return await _tenantRepository.GetAllAsync();
    }

    public async Task<Tenant?> GetTenantByIdAsync(string id)
    {
        return await _tenantRepository.GetByIdAsync(id);
    }

    public async Task<Tenant> CreateTenantAsync(Tenant tenant)
    {
        return await _tenantRepository.CreateAsync(tenant);
    }

    public async Task UpdateTenantAsync(Tenant tenant)
    {
        await _tenantRepository.UpdateAsync(tenant);
    }

    public async Task DeleteTenantAsync(string id)
    {
        await _tenantRepository.DeleteAsync(id);
    }
}
