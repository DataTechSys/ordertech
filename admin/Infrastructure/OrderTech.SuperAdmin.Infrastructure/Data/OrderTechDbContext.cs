using Microsoft.EntityFrameworkCore;
using OrderTech.SuperAdmin.Domain.Entities;

namespace OrderTech.SuperAdmin.Infrastructure.Data;

public class OrderTechDbContext : DbContext
{
    public OrderTechDbContext(DbContextOptions<OrderTechDbContext> options) : base(options)
    {
    }

    public DbSet<Tenant> Tenants { get; set; }
    public DbSet<User> Users { get; set; }
    public DbSet<Branch> Branches { get; set; }
    public DbSet<Order> Orders { get; set; }
    public DbSet<SalesOrder> SalesOrders { get; set; }
    public DbSet<Product> Products { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Tenant configuration
        modelBuilder.Entity<Tenant>(entity =>
        {
            entity.ToTable("tenants");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("tenant_id");
            entity.Property(e => e.FoodicsBusinessId).HasColumnName("foodics_business_id").IsRequired();
            entity.Property(e => e.FoodicsApiToken).HasColumnName("foodics_api_token").IsRequired();
            entity.Property(e => e.CompanyName).HasColumnName("company_name");
            entity.Property(e => e.IsDemo).HasColumnName("is_demo");
            entity.Property(e => e.LogoUrl).HasColumnName("logo_url");
            entity.Property(e => e.PrimaryColor).HasColumnName("primary_color");
            entity.Property(e => e.SecondaryColor).HasColumnName("secondary_color");
            entity.Property(e => e.SubscriptionStatus).HasColumnName("subscription_status");
            entity.Property(e => e.SubscriptionPlan).HasColumnName("subscription_plan");
            entity.Property(e => e.TrialEndsAt).HasColumnName("trial_ends_at");
            entity.Property(e => e.Settings).HasColumnName("settings");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.DeviceLimit).HasColumnName("device_limit");
            
            // Ignore computed properties
            entity.Ignore(e => e.Name);
            entity.Ignore(e => e.FoodicsAccountId);
            entity.Ignore(e => e.IsActive);
        });

        // User configuration
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Name).HasColumnName("name").IsRequired();
            entity.Property(e => e.PasswordHash).HasColumnName("password_hash").IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.ModifiedAt).HasColumnName("modified_at");
            entity.Property(e => e.RoleId).HasColumnName("role_id");
            entity.Property(e => e.Email).HasColumnName("email").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").IsRequired();
            entity.Property(e => e.InviteCode).HasColumnName("invite_code");
            entity.Property(e => e.InviteExpire).HasColumnName("invite_expire");
            entity.Property(e => e.InviteUsed).HasColumnName("invite_used");
            entity.Property(e => e.ImageUrl).HasColumnName("image_url");
            
            // Ignore computed properties
            entity.Ignore(e => e.IsActive);
            entity.Ignore(e => e.Role);
            
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Branch configuration
        modelBuilder.Entity<Branch>(entity =>
        {
            entity.ToTable("branches");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Name).HasColumnName("name").IsRequired();
            entity.Property(e => e.NameAr).HasColumnName("name_ar");
            entity.Property(e => e.Location).HasColumnName("location");
            entity.Property(e => e.ExternalId).HasColumnName("external_id");
            entity.Property(e => e.IsActive).HasColumnName("is_active");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            
            entity.HasOne(e => e.Tenant)
                .WithMany(t => t.Branches)
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Order configuration
        modelBuilder.Entity<Order>(entity =>
        {
            entity.ToTable("orders");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.BranchId).HasColumnName("branch_id");
            entity.Property(e => e.TicketNo).HasColumnName("ticket_no");
            entity.Property(e => e.Osn).HasColumnName("osn");
            entity.Property(e => e.CustomerName).HasColumnName("customer_name");
            entity.Property(e => e.Total).HasColumnName("total").HasColumnType("decimal(10,3)");
            entity.Property(e => e.Currency).HasColumnName("currency");
            entity.Property(e => e.Location).HasColumnName("location");
            entity.Property(e => e.PaidAt).HasColumnName("paid_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.ItemsJson).HasColumnName("items").HasColumnType("json");
            
            entity.HasOne(e => e.Tenant)
                .WithMany(t => t.Orders)
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
                
            entity.HasOne(e => e.Branch)
                .WithMany(b => b.Orders)
                .HasForeignKey(e => e.BranchId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // SalesOrder configuration (Foodics orders)
        modelBuilder.Entity<SalesOrder>(entity =>
        {
            entity.ToTable("sales_orders");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.ExternalId).HasColumnName("external_id");
            entity.Property(e => e.CustomerName).HasColumnName("customer_name");
            entity.Property(e => e.BranchName).HasColumnName("branch_name");
            entity.Property(e => e.Total).HasColumnName("total").HasColumnType("decimal(10,3)");
            entity.Property(e => e.Currency).HasColumnName("currency");
            entity.Property(e => e.Status).HasColumnName("status");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.ItemsJson).HasColumnName("items").HasColumnType("json");
            
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Product configuration
        modelBuilder.Entity<Product>(entity =>
        {
            entity.ToTable("products");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Name).HasColumnName("name").IsRequired();
            entity.Property(e => e.NameAr).HasColumnName("name_ar");
            entity.Property(e => e.Description).HasColumnName("description");
            entity.Property(e => e.Price).HasColumnName("price").HasColumnType("decimal(10,3)");
            entity.Property(e => e.ImageUrl).HasColumnName("image_url");
            entity.Property(e => e.Sku).HasColumnName("sku");
            entity.Property(e => e.IsActive).HasColumnName("is_active");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
