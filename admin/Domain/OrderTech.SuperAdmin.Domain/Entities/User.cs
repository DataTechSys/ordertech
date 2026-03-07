using System.ComponentModel.DataAnnotations.Schema;

namespace OrderTech.SuperAdmin.Domain.Entities;

public class User
{
    public Guid Id { get; set; }
    
    [Column("tenant_id")]
    public string TenantId { get; set; } = string.Empty;
    
    public string Name { get; set; } = string.Empty;
    
    [Column("password_hash")]
    public string PasswordHash { get; set; } = string.Empty;
    
    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
    
    [Column("modified_at")]
    public DateTime? ModifiedAt { get; set; }
    
    [Column("role_id")]
    public Guid RoleId { get; set; }
    
    public string Email { get; set; } = string.Empty;
    
    public string Status { get; set; } = "active";
    
    [Column("invite_code")]
    public Guid? InviteCode { get; set; }
    
    [Column("invite_expire")]
    public DateTime? InviteExpire { get; set; }
    
    [Column("invite_used")]
    public bool? InviteUsed { get; set; }
    
    [Column("image_url")]
    public string? ImageUrl { get; set; }
    
    // Computed/Helper properties
    [NotMapped]
    public bool IsActive => Status?.ToLower() == "active";
    
    [NotMapped]
    public string Role => "SuperAdmin"; // Will be determined by role_id lookup if needed
    
    // Navigation properties
    public Tenant? Tenant { get; set; }
}
