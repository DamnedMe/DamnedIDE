// Language detection for the merge tool (same mapping as the diff/edit editors).
export function detectLangForMerge(path?: string | null): string {
  if (!path) return 'plaintext'
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    cs: 'csharp', csproj: 'xml', sln: 'plaintext', slnx: 'plaintext',
    json: 'json', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
    sql: 'sql', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    ps1: 'powershell', sh: 'shell', bat: 'bat',
    gitignore: 'plaintext', dockerfile: 'dockerfile'
  }
  return map[ext || ''] || 'plaintext'
}
