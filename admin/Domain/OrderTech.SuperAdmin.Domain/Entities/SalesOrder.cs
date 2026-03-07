namespace OrderTech.SuperAdmin.Domain.Entities;

public class SalesOrder
{
    public Guid Id { get; set; }
    public string TenantId { get; set; } = string.Empty;
    public string? ExternalId { get; set; }
    public string? CustomerName { get; set; }
    public string? BranchName { get; set; }
    public decimal Total { get; set; }
    public string Currency { get; set; } = "KWD";
    public string Status { get; set; } = "unknown";
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public string ItemsJson { get; set; } = "[]";
    
    // Navigation properties
    public Tenant Tenant { get; set; } = null!;
}
