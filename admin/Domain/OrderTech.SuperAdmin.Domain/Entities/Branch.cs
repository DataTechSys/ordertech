namespace OrderTech.SuperAdmin.Domain.Entities;

public class Branch
{
    public Guid Id { get; set; }
    public string TenantId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? NameAr { get; set; }
    public string? Location { get; set; }
    public string? ExternalId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    
    // Navigation properties
    public Tenant Tenant { get; set; } = null!;
    public ICollection<Order> Orders { get; set; } = new List<Order>();
}
