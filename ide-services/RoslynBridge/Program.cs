using System.Text.Json;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Text;

var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

string? line;
while ((line = Console.ReadLine()) != null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    var id = 0;
    try
    {
        var req = JsonSerializer.Deserialize<BridgeRequest>(line, jsonOptions);
        if (req == null)
        {
            Write(new BridgeResponse { Id = id, Ok = false, Error = "invalid request" });
            continue;
        }
        id = req.Id;
        Write(await BridgeHandler.HandleAsync(req));
    }
    catch (Exception ex)
    {
        Write(new BridgeResponse { Id = id, Ok = false, Error = ex.Message });
    }
    Console.Out.Flush();
}

void Write(BridgeResponse r) => Console.WriteLine(JsonSerializer.Serialize(r, jsonOptions));

internal class BridgeRequest
{
    public int Id { get; set; }
    public string Cmd { get; set; } = "";
    public string? Solution { get; set; }
    public string? File { get; set; }
    public int Line { get; set; }
    public int Column { get; set; }
    public string? Text { get; set; }
}

internal class BridgeResponse
{
    public int Id { get; set; }
    public bool Ok { get; set; } = true;
    public string? Error { get; set; }
    public string Symbol { get; set; } = "";
    public string Signature { get; set; } = "";
    public string Type { get; set; } = "";
    public string Summary { get; set; } = "";
    public string Kind { get; set; } = "";
    public List<BridgeTarget> Targets { get; set; } = new();
    public List<BridgeDiagnostic> Diagnostics { get; set; } = new();
}

internal class BridgeTarget
{
    public string File { get; set; } = "";
    public int Line { get; set; }
    public int Column { get; set; }
}

internal class BridgeDiagnostic
{
    public string Code { get; set; } = "";
    public string Severity { get; set; } = "warning";
    public string Message { get; set; } = "";
    public int Line { get; set; }
    public int Column { get; set; }
    public int EndLine { get; set; }
    public int EndColumn { get; set; }
}

internal static class BridgeHandler
{
    private static Solution _solution = null!;
    private static readonly Dictionary<string, Document> _documents = new(StringComparer.OrdinalIgnoreCase);
    private static bool _refsComplete;

    public static async Task<BridgeResponse> HandleAsync(BridgeRequest req)
    {
        try
        {
            return req.Cmd switch
            {
                "open" => await OpenAsync(req),
                "definition" or "implementation" or "references" => await SymbolQueryAsync(req),
                "diagnostics" => await DiagnosticsAsync(req),
                "hover" => await HoverAsync(req),
                "ping" => new BridgeResponse { Id = req.Id, Ok = true },
                _ => new BridgeResponse { Id = req.Id, Ok = false, Error = $"unknown cmd {req.Cmd}" }
            };
        }
        catch (Exception ex)
        {
            return new BridgeResponse { Id = req.Id, Ok = false, Error = ex.ToString() };
        }
    }

    // Builds the in-memory symbol index: every source file under the solution root is
    // parsed in parallel (no MSBuild evaluation) and the compilation is warmed, so the
    // first semantic query is already instant.
    private static async Task<BridgeResponse> OpenAsync(BridgeRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Solution))
            return new BridgeResponse { Id = req.Id, Ok = false, Error = "no solution" };

        var root = Path.GetDirectoryName(req.Solution)!;
        var files = EnumerateSourceFiles(root).ToArray();
        var parsed = new (string Path, SyntaxTree? Tree)[files.Length];
        Parallel.For(0, files.Length, i =>
        {
            try
            {
                var text = File.ReadAllText(files[i]);
                parsed[i] = (files[i], CSharpSyntaxTree.ParseText(text, new CSharpParseOptions(LanguageVersion.Latest), path: files[i]));
            }
            catch { /* unreadable */ }
        });

        var ws = new AdhocWorkspace();
        var projInfo = ProjectInfo.Create(
            ProjectId.CreateNewId(), VersionStamp.Create(), "Fast", "Fast", LanguageNames.CSharp,
            filePath: null,
            metadataReferences: BuildReferences(root));
        ws.AddProject(projInfo);
        var project = ws.CurrentSolution.GetProject(projInfo.Id)!;
        foreach (var (path, tree) in parsed)
        {
            if (tree == null) continue;
            project = project.AddDocument(Path.GetFileName(path), tree.GetRoot(), filePath: path).Project;
        }
        _solution = project.Solution;
        IndexDocuments();

        // warm the compilation so the first query does not pay the one-time bind cost
        foreach (var p in _solution.Projects)
        {
            var c = await p.GetCompilationAsync();
            Console.Error.WriteLine($"[roslyn] compilazione pronta: {c?.SyntaxTrees.Count() ?? 0} trees");
        }

        return new BridgeResponse
        {
            Id = req.Id,
            Ok = true,
            Symbol = $"docs={_documents.Count}"
        };
    }

    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "bin", "obj", ".git", ".vs", ".worktrees", "node_modules", "dist", "out", "packages"
    };

    private static IEnumerable<string> EnumerateSourceFiles(string root)
    {
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            IEnumerable<string> subs;
            try { subs = Directory.EnumerateDirectories(dir); } catch { continue; }
            foreach (var d in subs)
            {
                if (!SkipDirs.Contains(Path.GetFileName(d))) stack.Push(d);
            }
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(dir, "*.cs"); } catch { continue; }
            foreach (var f in files) yield return f;
        }
    }

    private static List<MetadataReference>? _sdkRefs;

    // BCL references from the running runtime, so `string`, `Task`, `Guid`… resolve.
    private static List<MetadataReference> SdkReferences()
    {
        if (_sdkRefs != null) return _sdkRefs;
        var refs = new List<MetadataReference>();
        var dir = Path.GetDirectoryName(typeof(object).Assembly.Location);
        if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
        {
            foreach (var dll in Directory.EnumerateFiles(dir, "*.dll"))
            {
                try { refs.Add(MetadataReference.CreateFromFile(dll)); } catch { /* skip */ }
            }
        }
        _sdkRefs = refs;
        return refs;
    }

    // Real NuGet references from `obj/project.assets.json` under the solution root:
    // compile assemblies live under `targets.{tfm}.{pkg}.compile`, package folders in
    // `packageFolders`, package relative paths in `libraries.{pkg}.path`.
    private static List<MetadataReference> NuGetReferences(string root)
    {
        var refs = new List<MetadataReference>();
        var packageFolders = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            IEnumerable<string> subs;
            try { subs = Directory.EnumerateDirectories(dir); } catch { continue; }
            foreach (var d in subs)
            {
                var name = Path.GetFileName(d);
                if (name is not (".git" or ".worktrees" or "node_modules" or ".vs" or "bin")) stack.Push(d);
            }
            IEnumerable<string> assets;
            try { assets = Directory.EnumerateFiles(dir, "project.assets.json"); } catch { continue; }
            foreach (var assetsPath in assets)
            {
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(assetsPath));
                    var r = doc.RootElement;
                    if (r.TryGetProperty("packageFolders", out var pf))
                        foreach (var p in pf.EnumerateObject())
                            if (!packageFolders.Contains(p.Name)) packageFolders.Add(p.Name);
                    if (!r.TryGetProperty("targets", out var targets)) continue;
                    foreach (var tfm in targets.EnumerateObject())
                    {
                        foreach (var lib in tfm.Value.EnumerateObject())
                        {
                            var val = lib.Value;
                            if (!val.TryGetProperty("compile", out var comp)) continue;
                            var libRel = lib.Name;
                            if (r.TryGetProperty("libraries", out var libMeta) &&
                                libMeta.TryGetProperty(lib.Name, out var meta) &&
                                meta.TryGetProperty("path", out var pp))
                                libRel = pp.GetString() ?? lib.Name;
                            foreach (var entry in comp.EnumerateObject())
                            {
                                var rel = entry.Name;
                                if (string.IsNullOrEmpty(rel) || rel == "_._") continue;
                                foreach (var folder in packageFolders)
                                {
                                    var full = Path.GetFullPath(Path.Combine(folder, libRel, rel));
                                    if (!File.Exists(full)) continue;
                                    if (!seen.Add(full)) break;
                                    try { refs.Add(MetadataReference.CreateFromFile(full)); } catch { }
                                    break;
                                }
                            }
                        }
                    }
                }
                catch { /* skip malformed assets */ }
            }
        }
        return refs;
    }

    private static List<MetadataReference> BuildReferences(string root)
    {
        var refs = new List<MetadataReference>(SdkReferences());
        var nuget = NuGetReferences(root);
        _refsComplete = nuget.Count > 0;
        refs.AddRange(nuget);
        return refs;
    }

    private static void IndexDocuments()
    {
        _documents.Clear();
        foreach (var doc in _solution.Projects.SelectMany(p => p.Documents))
        {
            if (!string.IsNullOrEmpty(doc.FilePath))
                _documents[NormalizePath(doc.FilePath)] = doc;
        }
    }

    private static string NormalizePath(string path) => path.Replace('\\', '/');

    private static readonly SymbolDisplayFormat MethodFormat = new(
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameAndContainingTypes,
        genericsOptions: SymbolDisplayGenericsOptions.IncludeTypeParameters,
        memberOptions: SymbolDisplayMemberOptions.IncludeAccessibility |
                        SymbolDisplayMemberOptions.IncludeModifiers |
                        SymbolDisplayMemberOptions.IncludeParameters |
                        SymbolDisplayMemberOptions.IncludeType |
                        SymbolDisplayMemberOptions.IncludeContainingType,
        parameterOptions: SymbolDisplayParameterOptions.IncludeType |
                          SymbolDisplayParameterOptions.IncludeName |
                          SymbolDisplayParameterOptions.IncludeDefaultValue,
        miscellaneousOptions: SymbolDisplayMiscellaneousOptions.UseSpecialTypes |
                              SymbolDisplayMiscellaneousOptions.EscapeKeywordIdentifiers);

    private static string ExtractSummary(string xml)
    {
        if (string.IsNullOrWhiteSpace(xml)) return "";
        try
        {
            var doc = XDocument.Parse(xml);
            var summary = doc.Descendants("summary").FirstOrDefault()?.Value;
            var returns = doc.Descendants("returns").FirstOrDefault()?.Value;
            var text = string.Join(" ", new[] { summary, returns }.Where(s => !string.IsNullOrWhiteSpace(s)))
                .Replace('\r', ' ')
                .Replace('\n', ' ')
                .Trim();
            return System.Text.RegularExpressions.Regex.Replace(text, @"\s{2,}", " ");
        }
        catch { return ""; }
    }

    // Hover tooltip: signature (methods/types/properties) or type (variables/parameters)
    // plus the XML doc summary, like Visual Studio.
    private static async Task<BridgeResponse> HoverAsync(BridgeRequest req)
    {
        var res = new BridgeResponse { Id = req.Id, Ok = true };
        if (string.IsNullOrEmpty(req.File) || _solution == null || _documents.Count == 0) return res;
        if (!_documents.TryGetValue(NormalizePath(req.File), out var doc)) return res;

        var text = await doc.GetTextAsync();
        var pos = text.Lines.GetPosition(new LinePosition(Math.Max(0, req.Line - 1), Math.Max(0, req.Column - 1)));
        var sm = await doc.GetSemanticModelAsync();
        if (!string.IsNullOrEmpty(req.Text))
        {
            var edited = doc.WithText(SourceText.From(req.Text));
            sm = await edited.GetSemanticModelAsync();
        }
        var root = await doc.GetSyntaxRootAsync();
        if (sm == null || root == null) return res;

        var token = root.FindToken(pos);
        ISymbol? symbol = null;
        for (var n = token.Parent; n != null; n = n.Parent)
        {
            try { symbol = sm.GetSymbolInfo(n).Symbol; } catch { /* some nodes are not queryable */ }
            if (symbol == null)
            {
                try { symbol = sm.GetDeclaredSymbol(n); } catch { /* not a declaration node */ }
            }
            if (symbol != null) break;
        }
        if (symbol == null) return res;

        res.Symbol = symbol.Name;
        res.Kind = symbol.Kind.ToString();
        switch (symbol)
        {
            case IMethodSymbol or INamedTypeSymbol:
                res.Signature = symbol.ToDisplayString(MethodFormat);
                break;
            case IPropertySymbol pr:
                res.Signature = symbol.ToDisplayString(MethodFormat);
                res.Type = pr.Type.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat);
                break;
            case IFieldSymbol f:
                res.Type = f.Type.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat);
                res.Signature = $"{res.Type} {symbol.Name}";
                break;
            default:
                ITypeSymbol? type = symbol switch
                {
                    ILocalSymbol l => l.Type,
                    IParameterSymbol pa => pa.Type,
                    IEventSymbol ev => ev.Type,
                    _ => null
                };
                res.Type = type?.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat) ?? "";
                res.Signature = $"{res.Type} {symbol.Name}";
                break;
        }
        try { res.Summary = ExtractSummary(symbol.GetDocumentationCommentXml(expandIncludes: true)); } catch { /* no docs */ }
        return res;
    }

    // Compiler diagnostics (errors/warnings) for one file. `Text` (optional) reflects
    // unsaved edits without mutating the workspace used for navigation.
    private static async Task<BridgeResponse> DiagnosticsAsync(BridgeRequest req)
    {
        var res = new BridgeResponse { Id = req.Id, Ok = true };
        if (!_refsComplete) { Console.Error.WriteLine("[roslyn] diag: refs incomplete"); return res; }
        if (string.IsNullOrEmpty(req.File) || _solution == null || _documents.Count == 0) { Console.Error.WriteLine("[roslyn] diag: no solution/docs"); return res; }
        if (!_documents.TryGetValue(NormalizePath(req.File), out var doc)) { Console.Error.WriteLine($"[roslyn] diag: doc non trovato {req.File}"); return res; }

        var semanticModel = doc.GetSemanticModelAsync().GetAwaiter().GetResult();
        if (!string.IsNullOrEmpty(req.Text))
        {
            var edited = doc.WithText(SourceText.From(req.Text));
            semanticModel = edited.GetSemanticModelAsync().GetAwaiter().GetResult();
        }
        if (semanticModel == null) { Console.Error.WriteLine("[roslyn] diag: semantic model null"); return res; }

        var diags = semanticModel.GetDiagnostics().ToArray();
        Console.Error.WriteLine($"[roslyn] diag: {diags.Length} per {req.File} text={(req.Text?.Length ?? -1)}");
        foreach (var d in diags)
        {
            if (d.Severity is DiagnosticSeverity.Hidden or DiagnosticSeverity.Info) continue;
            if (!d.Location.IsInSource) continue;
            var span = d.Location.GetLineSpan();
            res.Diagnostics.Add(new BridgeDiagnostic
            {
                Code = d.Id,
                Severity = d.Severity == DiagnosticSeverity.Error ? "error" : "warning",
                Message = d.GetMessage(),
                Line = span.StartLinePosition.Line + 1,
                Column = span.StartLinePosition.Character + 1,
                EndLine = span.EndLinePosition.Line + 1,
                EndColumn = span.EndLinePosition.Character + 1
            });
        }
        return res;
    }

    private static async Task<BridgeResponse> SymbolQueryAsync(BridgeRequest req)
    {
        var res = new BridgeResponse { Id = req.Id, Ok = true };
        if (string.IsNullOrEmpty(req.File) || _solution == null || _documents.Count == 0) return res;
        if (!_documents.TryGetValue(NormalizePath(req.File), out var doc)) return res;

        var text = await doc.GetTextAsync();
        var pos = text.Lines.GetPosition(new LinePosition(Math.Max(0, req.Line - 1), Math.Max(0, req.Column - 1)));

        var sm = await doc.GetSemanticModelAsync();
        var root = await doc.GetSyntaxRootAsync();
        if (sm == null || root == null) return res;

        // Walk up from the token until a symbol resolves (identifier, call, member
        // access…). Declarations need GetDeclaredSymbol, usages need GetSymbolInfo.
        ISymbol? symbol = null;
        var token = root.FindToken(pos);
        for (var n = token.Parent; n != null; n = n.Parent)
        {
            try { symbol = sm.GetSymbolInfo(n).Symbol; } catch { /* some nodes are not queryable */ }
            if (symbol == null)
            {
                try { symbol = sm.GetDeclaredSymbol(n); } catch { /* not a declaration node */ }
            }
            if (symbol != null) break;
        }
        if (symbol == null) return res;
        res.Symbol = symbol.Name;

        IEnumerable<Location>? locations = req.Cmd switch
        {
            "definition" => symbol.Locations.Where(l => l.IsInSource),
            "implementation" => (await SymbolFinder.FindImplementationsAsync(symbol, _solution))
                .SelectMany(i => i.Locations).Where(l => l.IsInSource),
            _ => (await SymbolFinder.FindReferencesAsync(symbol, _solution))
                .SelectMany(r => r.Locations.Select(l => l.Location)).Where(l => l.IsInSource)
        };

        foreach (var loc in locations)
        {
            if (loc.SourceTree == null) continue;
            var span = loc.GetLineSpan();
            res.Targets.Add(new BridgeTarget
            {
                File = NormalizePath(loc.SourceTree.FilePath),
                Line = span.StartLinePosition.Line + 1,
                Column = span.StartLinePosition.Character + 1
            });
        }
        res.Targets = res.Targets
            .GroupBy(t => $"{t.File}|{t.Line}|{t.Column}")
            .Select(g => g.First())
            .ToList();
        return res;
    }
}
