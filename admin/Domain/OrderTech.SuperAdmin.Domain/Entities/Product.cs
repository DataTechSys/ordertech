namespace OrderTech.SuperAdmin.Domain.Entities;

public class Product
{
    public Guid Id { get; set; }
    public string TenantId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? NameAr { get; set; }
    public string? Description { get; set; }
    public decimal Price { get; set; }
    public string? ImageUrl { get; set; }
    public string? Sku { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    
    // Navigation properties
    public Tenant Tenant { get; set; } = null!;
}
