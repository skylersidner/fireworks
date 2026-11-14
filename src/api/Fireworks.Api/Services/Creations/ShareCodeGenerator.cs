using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Fireworks.Api.Services.Creations;

public interface IShareCodeGenerator
{
    /// <summary>A fresh, uniformly random share code. Uniqueness is the insert's job, not this one's.</summary>
    string NewCode();
}

/// <summary>
/// schema.md §9: 8 characters of Base58 (no <c>0</c>, <c>O</c>, <c>I</c>, <c>l</c>), case-sensitive,
/// about 47 bits, from a CSPRNG. A share code is the creation's public identifier and its only
/// access key, so it must not be guessable from another one.
/// </summary>
public sealed class ShareCodeGenerator : IShareCodeGenerator
{
    public const string Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    public const int Length = 8;

    /// <summary>
    /// The same pattern as the route constraint in <c>CreationsController</c>. <c>\z</c>, never
    /// <c>$</c>: with <c>$</c>, <c>abcdefgh%0A</c> matched the route and reached the action (measured).
    /// </summary>
    public static readonly Regex Pattern = new(@"^[1-9A-HJ-NP-Za-km-z]{8}\z", RegexOptions.CultureInvariant);

    public string NewCode() => new(RandomNumberGenerator.GetItems<char>(Alphabet, Length));
}
