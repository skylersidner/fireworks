using System.Text.Json;
using Fireworks.Api.Services.Creations;
using Fireworks.Api.Tests.Support;

namespace Fireworks.Api.Tests.Validation;

/// <summary>schema.md §5.2 item 3: <c>CreationLimits.cs</c> deep-equals <c>schema/limits.json</c>.</summary>
public sealed class CreationLimitsTests
{
    [Fact]
    public void CreationLimits_deep_equals_limits_json()
    {
        using var json = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RepoPaths.Schema, "limits.json")));
        var rows = json.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal);

        Assert.Equal(rows.Keys.Order(StringComparer.Ordinal), CreationLimits.Table.Keys.Order(StringComparer.Ordinal));
        foreach (var (key, (limit, maxReference)) in CreationLimits.Table)
        {
            var row = rows[key];
            Assert.Equal(row.GetProperty("min").GetDouble(), limit.Min);
            Assert.Equal(row.GetProperty("integer").GetBoolean(), limit.Integer);
            var max = row.GetProperty("max");
            if (maxReference is null)
            {
                Assert.Equal(JsonValueKind.Number, max.ValueKind);
                Assert.Equal(max.GetDouble(), limit.Max);
            }
            else
            {
                Assert.Equal(maxReference, max.GetString());
            }
        }
    }

    [Fact]
    public void Cue_t_falls_back_to_the_duration_maximum()
    {
        // Rule 8: when duration is invalid, t is bounded by 600, the duration's own max.
        Assert.Equal(CreationLimits.ShowDuration.Max, CreationLimits.CueT.Max);
    }
}
