using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Fireworks.Api.Controllers;

namespace Fireworks.Api.Tests.Support;

/// <summary>
/// Runs the real <c>Fireworks.Api.dll</c> — the real <c>Program.cs</c>, top to bottom — as a child
/// process, from this test project's output folder (the API's build output and appsettings files
/// are copied there by the project reference). For checks that a re-implemented harness cannot
/// make honestly: that startup fails fast on bad config, and the Program.cs pipeline itself.
///
/// <para>
/// The child's environment starts from this process's, minus every variable that would change how
/// the app configures itself, so the test states the whole configuration.
/// </para>
/// </summary>
internal sealed class ApiProcess : IAsyncDisposable
{
    private static readonly string[] ScrubbedPrefixes =
        ["ASPNETCORE_", "DOTNET_ENVIRONMENT", "DOTNET_URLS", "ConnectionStrings__", "Identity__", "Cors__", "RateLimiting__"];

    private readonly Process process;
    private readonly StringBuilder output = new();

    public string Output
    {
        get { lock (output) { return output.ToString(); } }
    }

    private ApiProcess(Process process) => this.process = process;

    public static ApiProcess Start(IReadOnlyDictionary<string, string> environment, params string[] args)
    {
        var appDll = typeof(MeController).Assembly.Location;
        var startInfo = new ProcessStartInfo
        {
            FileName = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet",
            WorkingDirectory = Path.GetDirectoryName(appDll)!,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        startInfo.ArgumentList.Add(appDll);
        foreach (var arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        foreach (var key in startInfo.Environment.Keys.ToList())
        {
            if (ScrubbedPrefixes.Any(prefix => key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
            {
                startInfo.Environment.Remove(key);
            }
        }

        foreach (var (key, value) in environment)
        {
            startInfo.Environment[key] = value;
        }

        var process = new Process { StartInfo = startInfo };
        var apiProcess = new ApiProcess(process);
        process.OutputDataReceived += (_, e) => apiProcess.Append(e.Data);
        process.ErrorDataReceived += (_, e) => apiProcess.Append(e.Data);
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return apiProcess;
    }

    public static int FreeLoopbackPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    /// <summary>Waits for the process to exit and returns its exit code; fails the test on timeout.</summary>
    public async Task<int> WaitForExitAsync(TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            throw new TimeoutException($"The API did not exit within {timeout}. Output so far:\n{Output}");
        }

        // WaitForExitAsync returns once the redirected streams reach EOF, so Output is complete.
        return process.ExitCode;
    }

    /// <summary>Waits until the output contains <paramref name="text"/>; fails if the process exits first.</summary>
    public async Task WaitForOutputAsync(string text, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (Output.Contains(text, StringComparison.Ordinal))
            {
                return;
            }

            if (process.HasExited)
            {
                throw new InvalidOperationException(
                    $"The API exited ({process.ExitCode}) before printing '{text}'. Output:\n{Output}");
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"The API did not print '{text}' within {timeout}. Output so far:\n{Output}");
    }

    private void Append(string? line)
    {
        if (line is null)
        {
            return;
        }

        lock (output)
        {
            output.AppendLine(line);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (!process.HasExited)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
        }

        process.Dispose();
    }
}
