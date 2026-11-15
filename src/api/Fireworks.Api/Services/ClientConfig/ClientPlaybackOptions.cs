using System.ComponentModel.DataAnnotations;

namespace Fireworks.Api.Services.ClientConfig;

/// <summary>
/// The <c>ClientPlayback</c> configuration section: the Show Builder's playback-tuning knobs, which
/// the SPA reads once at page load from <c>GET api/client-config</c>. Committed in
/// <c>appsettings.json</c>; overridden per deploy with <c>ClientPlayback__SeekBudgetMs=40</c> and so
/// on. The README's "Playback tuning" section says what each one does.
///
/// <para>
/// The defaults below equal the committed values (a committed-config test pins both), so a host
/// with no appsettings file, such as the test harness, serves the same numbers. The ranges are
/// checked at startup (<see cref="ClientConfigRegistration.AddFireworksClientConfig"/>); the browser
/// clamps to the same ranges as a second line.
/// </para>
/// </summary>
public sealed class ClientPlaybackOptions
{
    public const string SectionName = "ClientPlayback";

    /// <summary>Milliseconds of seek or catch-up simulation per animation frame.</summary>
    [Range(4, 100, ErrorMessage = "ClientPlayback:SeekBudgetMs must be between {1} and {2} (milliseconds per frame).")]
    public int SeekBudgetMs { get; init; } = 25;

    /// <summary>How long a seek must run before "Catching up…" shows, in milliseconds.</summary>
    [Range(0, 5000, ErrorMessage = "ClientPlayback:CatchingUpDelayMs must be between {1} and {2} (milliseconds).")]
    public int CatchingUpDelayMs { get; init; } = 300;

    /// <summary>Show time between seek snapshots, in seconds (TimelineDriver <c>checkpointSteps</c> / 120).</summary>
    [Range(1, 60, ErrorMessage = "ClientPlayback:CheckpointIntervalSeconds must be between {1} and {2} (seconds of show time).")]
    public int CheckpointIntervalSeconds { get; init; } = 10;

    /// <summary>Memory cap for seek snapshots, in MiB (TimelineDriver <c>checkpointBytes</c>).</summary>
    [Range(8, 512, ErrorMessage = "ClientPlayback:CheckpointMemoryMiB must be between {1} and {2} (MiB).")]
    public int CheckpointMemoryMiB { get; init; } = 64;
}
