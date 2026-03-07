namespace OrderTech.SuperAdmin.Domain.Entities;

public class Order
{
    public Guid Id { get; set; }
    public string TenantId { get; set; } = string.Empty;
    public Guid? BranchId { get; set; }
    public string? TicketNo { get; set; }
    public string? Osn { get; set; }
    public string? CustomerName { get; set; }
    public decimal Total { get; set; }
    public string Currency { get; set; } = "KWD";
    public string? Location { get; set; }
    public DateTime? PaidAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public string ItemsJson { get; set; } = "[]";
    
    // Navigation properties
    public Tenant Tenant { get; set; } = null!;
    public Branch? Branch { get; set; }
}
