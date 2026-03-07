using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace OrderTech.SuperAdmin.Domain.Entities;

public class Tenant
{
    [Key]
    [Column("tenant_id")]
    public Guid Id { get; set; }
    
    [Column("foodics_business_id")]
    public string FoodicsBusinessId { get; set; } = string.Empty;
    
    [Column("foodics_api_token")]
    public string FoodicsApiToken { get; set; } = string.Empty;
    
    [Column("company_name")]
    public string? CompanyName { get; set; }
    
    [Column("is_demo")]
    public bool? IsDemo { get; set; }
    
    [Column("logo_url")]
    public string? LogoUrl { get; set; }
    
    [Column("primary_color")]
    public string? PrimaryColor { get; set; }
    
    [Column("secondary_color")]
    public string? SecondaryColor { get; set; }
    
    [Column("subscription_status")]
    public string? SubscriptionStatus { get; set; }
    
    [Column("subscription_plan")]
    public string? SubscriptionPlan { get; set; }
    
    [Column("trial_ends_at")]
    public DateTime? TrialEndsAt { get; set; }
    
    public string? Settings { get; set; }
    
    [Column("created_at")]
    public DateTime? CreatedAt { get; set; }
    
    [Column("updated_at")]
    public DateTime? UpdatedAt { get; set; }
    
    [Column("device_limit")]
    public int? DeviceLimit { get; set; }
    
    // Computed properties for compatibility
    [NotMapped]
    public string Name => CompanyName ?? "Unnamed Tenant";
    
    [NotMapped]
    public string? FoodicsAccountId => FoodicsBusinessId;
    
    [NotMapped]
    public bool IsActive => SubscriptionStatus?.ToLower() == "active";
    
    // Navigation properties
    public ICollection<Branch> Branches { get; set; } = new List<Branch>();
    public ICollection<Order> Orders { get; set; } = new List<Order>();
}
