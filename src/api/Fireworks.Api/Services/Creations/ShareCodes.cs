namespace Fireworks.Api.Services.Creations;

/// <summary>
/// The share-code format check (schema.md §9), ordinal and per character. Used by the route
/// constraint and again by the service before any query (Boo S14).
///
/// <para>
/// Not a <c>regex(...)</c> route constraint: ASP.NET builds those with <c>IgnoreCase</c>, so
/// <c>abcdefgl</c>, <c>abcdefgI</c>, <c>abcdefgO</c> and the Kelvin sign (which case-folds to
/// <c>k</c>) all reached the action (Boo, measured).
/// </para>
/// </summary>
public static class ShareCodes
{
    public static bool IsValid(string? code)
    {
        if (code is null || code.Length != ShareCodeGenerator.Length)
        {
            return false;
        }

        foreach (var c in code)
        {
            // Ordinal: IndexOf(char) compares code units exactly.
            if (ShareCodeGenerator.Alphabet.IndexOf(c) < 0)
            {
                return false;
            }
        }

        return true;
    }
}

/// <summary><c>{shareCode:sharecode}</c>. A code that fails it is a 404 with no database query.</summary>
public sealed class ShareCodeRouteConstraint : IRouteConstraint
{
    public const string Name = "sharecode";

    public bool Match(HttpContext? httpContext, IRouter? route, string routeKey, RouteValueDictionary values, RouteDirection routeDirection) =>
        values.TryGetValue(routeKey, out var value) && ShareCodes.IsValid(value as string);
}
