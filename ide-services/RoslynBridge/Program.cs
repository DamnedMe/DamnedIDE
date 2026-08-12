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

    // name index (identifier → file+offset) built once at open, used for fast
    // reference/implementation lookups with parallel semantic binding
    private static Dictionary<string, List<(string File, int Offset)>> _nameIndex = new(StringComparer.OrdinalIgnoreCase);

    // Builds the in-memory symbol index: one Roslyn project per .csproj (real project
    // references from the csproj XML + per-project NuGet references from obj/assets),
    // files parsed in parallel, compilations warmed in parallel. Small compilations →
    // fast navigation and precise cross-project resolution.
    private static async Task<BridgeResponse> OpenAsync(BridgeRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Solution))
            return new BridgeResponse { Id = req.Id, Ok = false, Error = "no solution" };

        var root = Path.GetDirectoryName(req.Solution)!;
        var projects = DiscoverProjects(root);
        var sdkRefs = SdkReferences();
        _refsComplete = false;

        // per-project metadata references (SDK + NuGet from that project's assets)
        var projRefs = new Dictionary<string, List<MetadataReference>>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in projects)
        {
            var refs = new List<MetadataReference>(sdkRefs);
            var assets = Path.Combine(p.Dir, "obj", "project.assets.json");
            var nuget = NuGetReferencesFromAssets(assets);
            if (nuget.Count > 0) _refsComplete = true;
            refs.AddRange(nuget);
            projRefs[p.Csproj] = refs;
        }

        // parse every source file in parallel
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

        // map each file to its project (longest directory prefix)
        var fileProjects = new Dictionary<string, ProjDef>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in files)
        {
            var dir = Path.GetDirectoryName(f) ?? "";
            ProjDef? best = null;
            var bestLen = -1;
            foreach (var p in projects)
            {
                if (dir.Length >= p.Dir.Length &&
                    dir.StartsWith(p.Dir, StringComparison.OrdinalIgnoreCase) &&
                    p.Dir.Length > bestLen)
                {
                    best = p;
                    bestLen = p.Dir.Length;
                }
            }
            if (best != null) fileProjects[f] = best;
        }

        var ws = new AdhocWorkspace();
        var idByCsproj = new Dictionary<string, ProjectId>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in projects) idByCsproj[p.Csproj] = ProjectId.CreateNewId();
        // add ALL projects first (references are applied after, otherwise Roslyn drops them)
        foreach (var p in projects)
        {
            var info = ProjectInfo.Create(
                idByCsproj[p.Csproj], VersionStamp.Create(),
                Path.GetFileNameWithoutExtension(p.Csproj), Path.GetFileNameWithoutExtension(p.Csproj),
                LanguageNames.CSharp,
                filePath: p.Csproj,
                metadataReferences: projRefs[p.Csproj]);
            ws.AddProject(info);
        }
        var sol = ws.CurrentSolution;
        foreach (var p in projects)
        {
            var refs = ParseProjectReferences(p.Csproj)
                .Where(r => idByCsproj.ContainsKey(r))
                .Select(r => new ProjectReference(idByCsproj[r]))
                .ToArray();
            if (refs.Length > 0) sol = sol.WithProjectReferences(idByCsproj[p.Csproj], refs);
        }
        ws.TryApplyChanges(sol);
        // synthetic global usings: the SDK-generated GlobalUsings.g.cs lives in obj/ and
        // is excluded from the scan, so implicit usings would break web projects
        const string GlobalUsings = """
            global using System;
            global using System.Collections.Generic;
            global using System.IO;
            global using System.Linq;
            global using System.Net.Http;
            global using System.Threading;
            global using System.Threading.Tasks;
            global using Microsoft.AspNetCore.Builder;
            global using Microsoft.AspNetCore.Hosting;
            global using Microsoft.AspNetCore.Http;
            global using Microsoft.Extensions.Configuration;
            global using Microsoft.Extensions.DependencyInjection;
            global using Microsoft.Extensions.Hosting;
            global using Microsoft.Extensions.Logging;
            """;
        foreach (var p in projects)
        {
            var proj = sol.GetProject(idByCsproj[p.Csproj])!;
            sol = proj.AddDocument("_GlobalUsings.cs", GlobalUsings).Project.Solution;
        }
        foreach (var (path, tree) in parsed)
        {
            if (tree == null) continue;
            if (!fileProjects.TryGetValue(path, out var p)) continue;
            var proj = sol.GetProject(idByCsproj[p.Csproj])!;
            sol = proj.AddDocument(Path.GetFileName(path), tree.GetRoot(), filePath: path).Project.Solution;
        }
        _solution = sol;
        IndexDocuments();

        // build the identifier name index (parallel) for fast reference/implementation lookups
        var index = new System.Collections.Concurrent.ConcurrentDictionary<string, System.Collections.Concurrent.ConcurrentBag<(string File, int Offset)>>(StringComparer.OrdinalIgnoreCase);
        Parallel.For(0, parsed.Length, i =>
        {
            var (path, tree) = parsed[i];
            if (tree == null) return;
            foreach (var tok in tree.GetRoot().DescendantTokens())
            {
                if (!tok.IsKind(SyntaxKind.IdentifierToken)) continue;
                var t = tok.Text;
                if (t.Length < 2 || t.Length > 80) continue;
                index.GetOrAdd(t, _ => new System.Collections.Concurrent.ConcurrentBag<(string, int)>()).Add((path, tok.SpanStart));
            }
        });
        _nameIndex = index.ToDictionary(kv => kv.Key, kv => kv.Value.ToList(), StringComparer.OrdinalIgnoreCase);
        Console.Error.WriteLine($"[roslyn] name index: {_nameIndex.Count} nomi");

        // warm all compilations in parallel so the first query is instant
        var compTasks = _solution.Projects.Select(p => p.GetCompilationAsync()).ToArray();
        await Task.WhenAll(compTasks);
        Console.Error.WriteLine($"[roslyn] {compTasks.Length} progetti compilati, docs={_documents.Count}");

        return new BridgeResponse
        {
            Id = req.Id,
            Ok = true,
            Symbol = $"projects={compTasks.Length}, docs={_documents.Count}"
        };
    }

    private sealed class ProjDef
    {
        public string Csproj = "";
        public string Dir = "";
    }

    private static List<ProjDef> DiscoverProjects(string root)
    {
        var list = new List<ProjDef>();
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
                if (name is not (".git" or ".worktrees" or "node_modules" or ".vs" or "bin" or "obj" or "dist" or "out" or "packages"))
                    stack.Push(d);
            }
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(dir, "*.csproj"); } catch { continue; }
            foreach (var f in files) list.Add(new ProjDef { Csproj = f, Dir = dir });
        }
        return list;
    }

    private static List<string> ParseProjectReferences(string csproj)
    {
        var refs = new List<string>();
        try
        {
            var doc = XDocument.Load(csproj);
            var csprojDir = Path.GetDirectoryName(csproj) ?? "";
            foreach (var pr in doc.Descendants().Where(e => e.Name.LocalName == "ProjectReference"))
            {
                var inc = pr.Attribute("Include")?.Value;
                if (string.IsNullOrEmpty(inc)) continue;
                var full = Path.GetFullPath(Path.Combine(csprojDir, inc));
                if (!refs.Any(r => string.Equals(r, full, StringComparison.OrdinalIgnoreCase))) refs.Add(full);
            }
        }
        catch { /* malformed csproj */ }
        return refs;
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

    // BCL references from the running runtime + ASP.NET Core shared framework, so
    // `string`, `Task`, `Guid`, `ControllerBase`… resolve in web projects too.
    private static List<MetadataReference> SdkReferences()
    {
        if (_sdkRefs != null) return _sdkRefs;
        var refs = new List<MetadataReference>();
        var coreDir = Path.GetDirectoryName(typeof(object).Assembly.Location);
        if (!string.IsNullOrEmpty(coreDir) && Directory.Exists(coreDir))
        {
            foreach (var dll in Directory.EnumerateFiles(coreDir, "*.dll"))
            {
                try { refs.Add(MetadataReference.CreateFromFile(dll)); } catch { /* native dlls */ }
            }
            var sharedDir = Directory.GetParent(coreDir)?.Parent?.FullName; // ...\shared
            if (sharedDir != null)
            {
                var aspBase = Path.Combine(sharedDir, "Microsoft.AspNetCore.App");
                var aspVer = Directory.Exists(aspBase)
                    ? Directory.EnumerateDirectories(aspBase).OrderByDescending(d => d).FirstOrDefault()
                    : null;
                if (aspVer != null)
                {
                    foreach (var dll in Directory.EnumerateFiles(aspVer, "*.dll"))
                    {
                        try { refs.Add(MetadataReference.CreateFromFile(dll)); } catch { /* skip */ }
                    }
                }
            }
        }
        _sdkRefs = refs;
        return refs;
    }

    private static readonly HashSet<string> _seenRefs = new(StringComparer.OrdinalIgnoreCase);

    // Real NuGet references from ONE `obj/project.assets.json`:
    // compile assemblies live under `targets.{tfm}.{pkg}.compile`, package folders in
    // `packageFolders`, package relative paths in `libraries.{pkg}.path`.
    private static List<MetadataReference> NuGetReferencesFromAssets(string assetsPath)
    {
        var refs = new List<MetadataReference>();
        if (!File.Exists(assetsPath)) return refs;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(assetsPath));
            var r = doc.RootElement;
            var packageFolders = new List<string>();
            if (r.TryGetProperty("packageFolders", out var pf))
                foreach (var p in pf.EnumerateObject())
                    if (!packageFolders.Contains(p.Name)) packageFolders.Add(p.Name);
            if (!r.TryGetProperty("targets", out var targets)) return refs;
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
                            if (!_seenRefs.Add(full)) break;
                            try { refs.Add(MetadataReference.CreateFromFile(full)); } catch { }
                            break;
                        }
                    }
                }
            }
        }
        catch { /* skip malformed assets */ }
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

        var targets = req.Cmd switch
        {
            "definition" => symbol.Locations
                .Where(l => l.IsInSource)
                .Select(ToTarget)
                .ToList(),
            "implementation" => await FindImplementationsFastAsync(symbol),
            _ => await FindReferencesFastAsync(symbol)
        };

        res.Targets = targets
            .GroupBy(t => $"{t.File}|{t.Line}|{t.Column}")
            .Select(g => g.First())
            .ToList();
        return res;
    }

    private static BridgeTarget ToTarget(Location loc)
    {
        if (loc.SourceTree == null) return new BridgeTarget();
        var span = loc.GetLineSpan();
        return new BridgeTarget
        {
            File = NormalizePath(loc.SourceTree.FilePath),
            Line = span.StartLinePosition.Line + 1,
            Column = span.StartLinePosition.Character + 1
        };
    }

    // Binds an identifier token at (file, offset) to its symbol.
    private static ISymbol? BindAt(string file, int offset)
    {
        if (!_documents.TryGetValue(NormalizePath(file), out var doc)) return null;
        var root = doc.GetSyntaxRootAsync().GetAwaiter().GetResult();
        var sm = doc.GetSemanticModelAsync().GetAwaiter().GetResult();
        if (root == null || sm == null) return null;
        var token = root.FindToken(offset);
        if (token.IsKind(SyntaxKind.None) || token.Parent == null) return null;
        for (var n = token.Parent; n != null; n = n.Parent)
        {
            try
            {
                var s = sm.GetSymbolInfo(n).Symbol;
                if (s != null) return s;
                var d = sm.GetDeclaredSymbol(n);
                if (d != null) return d;
            }
            catch { /* not queryable */ }
        }
        return null;
    }

    // Fast references: name-index candidates + parallel semantic binding, with a
    // SymbolFinder fallback when the index yields nothing. Symbols are compared by
    // their fully-qualified display string because candidates may live in different
    // project compilations (SymbolEqualityComparer is compilation-local).
    private static async Task<List<BridgeTarget>> FindReferencesFastAsync(ISymbol symbol)
    {
        var res = new List<BridgeTarget>();
        var candidates = _nameIndex.TryGetValue(symbol.Name, out var list) ? list : [];
        var bag = new System.Collections.Concurrent.ConcurrentBag<BridgeTarget>();
        var targetDisplay = symbol.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat);
        Parallel.ForEach(candidates, c =>
        {
            var s = BindAt(c.File, c.Offset);
            if (s != null &&
                string.Equals(s.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat), targetDisplay, StringComparison.Ordinal) &&
                _documents.TryGetValue(NormalizePath(c.File), out var doc))
            {
                var tree = doc.GetSyntaxTreeAsync().GetAwaiter().GetResult();
                var ls = tree?.GetLineSpan(new Microsoft.CodeAnalysis.Text.TextSpan(c.Offset, Math.Min(symbol.Name.Length, 40)));
                if (ls.HasValue)
                    bag.Add(new BridgeTarget { File = NormalizePath(c.File), Line = ls.Value.StartLinePosition.Line + 1, Column = ls.Value.StartLinePosition.Character + 1 });
            }
        });
        res.AddRange(bag);
        if (res.Count == 0)
        {
            var refs = await SymbolFinder.FindReferencesAsync(symbol, _solution);
            res.AddRange(refs.SelectMany(r => r.Locations.Select(l => l.Location)).Where(l => l.IsInSource).Select(ToTarget));
        }
        return res;
    }

    // Fast implementations: candidates with the same name whose containing type
    // implements the interface member (or overrides the virtual/abstract member).
    private static async Task<List<BridgeTarget>> FindImplementationsFastAsync(ISymbol symbol)
    {
        var res = new List<BridgeTarget>();
        var ifaceMember = symbol as IMethodSymbol;
        var iface = symbol.ContainingType is { TypeKind: TypeKind.Interface } ? symbol.ContainingType : null;
        var candidates = _nameIndex.TryGetValue(symbol.Name, out var list) ? list : [];
        var bag = new System.Collections.Concurrent.ConcurrentBag<BridgeTarget>();
        var memberSig = ifaceMember?.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat);
        var symbolSig = symbol.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat);
        Parallel.ForEach(candidates, c =>
        {
            if (BindAt(c.File, c.Offset) is not IMethodSymbol m) return;
            if (!string.Equals(m.Name, symbol.Name, StringComparison.Ordinal)) return;
            var isImpl = false;
            if (iface != null && ifaceMember != null)
            {
                var t = m.ContainingType;
                isImpl = t.TypeKind == TypeKind.Class &&
                         t.AllInterfaces.Any(i => string.Equals(i.ToDisplayString(), iface.ToDisplayString(), StringComparison.Ordinal)) &&
                         string.Equals(m.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat), memberSig, StringComparison.Ordinal);
            }
            else if (m.IsOverride && m.OverriddenMethod != null)
            {
                var cur = m.OverriddenMethod;
                while (cur != null)
                {
                    if (string.Equals(cur.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat), symbolSig, StringComparison.Ordinal)) { isImpl = true; break; }
                    cur = cur.OverriddenMethod;
                }
            }
            else if (string.Equals(m.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat), symbolSig, StringComparison.Ordinal))
            {
                isImpl = true; // the declaration itself
            }
            if (!isImpl) return;
            var loc = m.Locations.FirstOrDefault(l => l.IsInSource);
            if (loc != null) bag.Add(ToTarget(loc));
        });
        res.AddRange(bag);
        if (res.Count == 0)
        {
            var impls = await SymbolFinder.FindImplementationsAsync(symbol, _solution);
            res.AddRange(impls.SelectMany(i => i.Locations).Where(l => l.IsInSource).Select(ToTarget));
        }
        return res;
    }
}
