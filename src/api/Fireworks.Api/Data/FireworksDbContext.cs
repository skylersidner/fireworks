using Fireworks.Api.Data.Entities;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Fireworks.Api.Data;

public sealed class FireworksDbContext(DbContextOptions<FireworksDbContext> options)
    : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Creation> Creations => Set<Creation>();

    /// <summary>
    /// The DataProtection key ring (design §3.7), so session cookies, OAuth <c>state</c> and the
    /// correlation cookie survive a restart. Stored unencrypted (Boo A37): a database read or a
    /// backup file is a credential.
    /// </summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    public override int SaveChanges()
    {
        ApplyTimestamps();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        ApplyTimestamps();
        return base.SaveChangesAsync(cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Every table and column is named explicitly in snake_case. Nothing relies on an EF
        // naming convention, so the Postgres schema and the SQLite test schema are built from the
        // same names.
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(e => e.Id);
            // The id is always supplied (Guid.CreateVersion7() at provisioning), never generated
            // by the database.
            entity.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
            entity.Property(e => e.DisplayName).HasColumnName("display_name")
                .HasMaxLength(User.DisplayNameMaxLength).IsRequired();
            entity.Property(e => e.ExternalProvider).HasColumnName("external_provider")
                .HasMaxLength(User.ExternalProviderMaxLength);
            entity.Property(e => e.ExternalSubject).HasColumnName("external_subject")
                .HasMaxLength(User.ExternalSubjectMaxLength);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            // One row per external identity. SQLite and Postgres both allow many (NULL, NULL)
            // pairs under a unique index, which is the legacy default user's row.
            entity.HasIndex(e => new { e.ExternalProvider, e.ExternalSubject }).IsUnique()
                .HasDatabaseName("ix_users_external_provider_subject");
            entity.ToTable(t => t.HasCheckConstraint(
                "ck_users_external_identity_both_or_neither",
                "(external_provider IS NULL) = (external_subject IS NULL)"));
        });

        modelBuilder.Entity<DataProtectionKey>(entity =>
        {
            entity.ToTable("data_protection_keys");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.FriendlyName).HasColumnName("friendly_name");
            entity.Property(e => e.Xml).HasColumnName("xml");
        });

        var isNpgsql = Database.IsNpgsql();

        modelBuilder.Entity<Creation>(entity =>
        {
            entity.ToTable("creations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();

            // Unique, and compared ordinally (schema.md §9). On Postgres the column gets the "C"
            // collation: the database default here and on most hosts is en_US.utf8, which sorts
            // 'a' before 'B' (measured on the compose server), so ORDER BY share_code, the paging
            // tiebreak (§2.2.1), would not be ordinal. SQLite's default BINARY already is.
            var shareCode = entity.Property(e => e.ShareCode).HasColumnName("share_code")
                .HasMaxLength(Creation.ShareCodeMaxLength).IsRequired();
            if (isNpgsql)
            {
                shareCode.UseCollation("C");
            }
            entity.HasIndex(e => e.ShareCode).IsUnique().HasDatabaseName("ix_creations_share_code");

            entity.Property(e => e.Kind).HasColumnName("kind")
                .HasMaxLength(Creation.KindMaxLength).IsRequired()
                .HasConversion(
                    kind => kind == CreationKind.Shell ? "shell" : "show",
                    value => value == "shell" ? CreationKind.Shell : CreationKind.Show);
            entity.Property(e => e.Name).HasColumnName("name")
                .HasMaxLength(Creation.NameMaxLength).IsRequired();
            entity.Property(e => e.SchemaVersion).HasColumnName("schema_version");
            // A primitive collection: text[] on Npgsql, JSON text on SQLite. Only ever read whole.
            entity.Property(e => e.Palette).HasColumnName("palette").IsRequired();

            // jsonb on Postgres; TEXT on SQLite (tests). Nothing queries inside it, so the two
            // providers can't diverge (bowser-provider-agnostic-queries.md).
            var document = entity.Property(e => e.Document).HasColumnName("document").IsRequired();
            if (isNpgsql)
            {
                document.HasColumnType("jsonb");
            }

            entity.Property(e => e.OwnerUserId).HasColumnName("owner_user_id");
            entity.HasOne<User>().WithMany()
                .HasForeignKey(e => e.OwnerUserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_creations_users_owner_user_id");

            entity.Property(e => e.RemixedFromId).HasColumnName("remixed_from_id");
            entity.HasOne(e => e.RemixedFrom).WithMany()
                .HasForeignKey(e => e.RemixedFromId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_creations_creations_remixed_from_id");
            entity.HasIndex(e => e.RemixedFromId).HasDatabaseName("ix_creations_remixed_from_id");

            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            // A concurrency token, so PUT's If-Match is checked IN the UPDATE (WHERE ... AND
            // updated_at = @expected), never by a read followed by a write (design §5.3, Boo A29).
            // No schema change: it only shapes the UPDATE's WHERE clause.
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at").IsConcurrencyToken();

            // "My creations": WHERE owner_user_id = @me ORDER BY updated_at DESC, share_code. The
            // share_code tiebreak keeps page boundaries stable when two rows share a timestamp.
            entity.HasIndex(e => new { e.OwnerUserId, e.UpdatedAt, e.ShareCode })
                .IsDescending(false, true, false)
                .HasDatabaseName("ix_creations_owner_updated_share_code");
        });

        if (!isNpgsql)
        {
            // Test-provider shim, model only. EF's SQLite provider stores DateTimeOffset as TEXT and
            // refuses to ORDER BY it, which the my-creations query must do. Stored as UTC ticks on
            // SQLite only, the query stays the same LINQ on both providers. Every timestamp is
            // written as UTC (ApplyTimestamps), so no offset is lost.
            var utcTicks = new ValueConverter<DateTimeOffset, long>(
                value => value.UtcTicks,
                ticks => new DateTimeOffset(ticks, TimeSpan.Zero));
            foreach (var property in modelBuilder.Model.GetEntityTypes()
                         .SelectMany(t => t.GetProperties())
                         .Where(p => p.ClrType == typeof(DateTimeOffset)))
            {
                property.SetValueConverter(utcTicks);
            }
        }
    }

    private void ApplyTimestamps()
    {
        // Truncated to whole microseconds, Postgres timestamptz's precision. Otherwise the value a
        // write returns (100 ns ticks, still in memory) differs from what the next read returns,
        // and a client comparing updatedAt values would see a change that never happened.
        var utcNow = DateTimeOffset.UtcNow;
        var now = new DateTimeOffset(utcNow.UtcTicks - utcNow.UtcTicks % 10, TimeSpan.Zero);

        foreach (var entry in ChangeTracker.Entries<ITimestamped>())
        {
            if (entry.State == EntityState.Added)
            {
                if (entry.Entity.CreatedAt == default)
                {
                    entry.Entity.CreatedAt = now;
                }

                entry.Entity.UpdatedAt = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
            }
        }
    }
}
