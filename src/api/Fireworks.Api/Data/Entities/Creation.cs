namespace Fireworks.Api.Data.Entities;

public enum CreationKind
{
    Shell,
    Show
}

/// <summary>
/// A saved shell or show (plan Phase 4, schema.md §2). One row per creation; the document is
/// stored as canonical JSON (<c>jsonb</c> on Postgres, TEXT on SQLite).
///
/// <para>
/// <see cref="Name"/>, <see cref="SchemaVersion"/> and <see cref="Palette"/> are computed from the
/// validated document at write time, so the server never re-reads a stored document and needs no
/// upgraders (schema.md §2.2, §8.1). Nothing ever queries inside <see cref="Document"/>
/// (<c>bowser-provider-agnostic-queries.md</c>).
/// </para>
/// </summary>
public sealed class Creation : ITimestamped
{
    /// <summary>Codes are 8 characters today (schema.md §9); 12 leaves room to lengthen them without a migration.</summary>
    public const int ShareCodeMaxLength = 12;

    /// <summary>Code points, which is what Postgres <c>varchar(n)</c> counts (schema.md §6.4).</summary>
    public const int NameMaxLength = 80;

    public const int KindMaxLength = 8;

    public Guid Id { get; init; }

    /// <summary>Settable only so an insert can retry with a fresh code after a collision.</summary>
    public required string ShareCode { get; set; }

    /// <summary>Fixed at creation; an update cannot change it (schema.md §2.1).</summary>
    public CreationKind Kind { get; init; }

    public required string Name { get; set; }
    public int SchemaVersion { get; set; }
    public List<string> Palette { get; set; } = [];

    /// <summary>The canonical JSON re-serialized from the validated DTO, never the request text.</summary>
    public required string Document { get; set; }

    /// <summary>Always <c>ICurrentUser.UserId</c> at create or remix, never a request field.</summary>
    public Guid OwnerUserId { get; init; }

    /// <summary>The creation this was remixed from; set to null by the database when that one is deleted.</summary>
    public Guid? RemixedFromId { get; init; }

    public Creation? RemixedFrom { get; init; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
